# -*- coding: utf-8 -*-
"""
B站评论四榜分析器（纯代码规则版，不调用AI大模型）
将评论分为四个独立榜单，互不混排：
  1. 共鸣王  —— 群体反馈：点赞数 + 回复层数
  2. 故事王  —— 真实亲历：第一人称 + 时间 + 数字 + 情绪 + 事例
  3. 干货王  —— 知识增量：机构/论文/剂量/价格/引用 + 新视角/纠错
  4. 问答王  —— 对话价值：求助提问 + UP主回复

规则说明：每榜用"信号词命中"打分，命中即给分，分数高者入围。
规则是起点，后续可依据大量数据统计调整信号词与权重。

用法:
  python bili_rankings.py [CSV文件] [--top N] [-o 输出.md]

示例:
  python bili_rankings.py exports/xxx.csv --top 10
"""
import argparse
import csv
import glob
import os
import re
import sys


# ============ 四榜信号词库（可依据数据持续调整） ============

# 故事王：第一人称 / 亲属
STORY_ME = ["我", "我爸", "我妈", "我爷爷", "我奶奶", "我外公", "我外婆", "我老公",
            "我老婆", "我儿子", "我女儿", "我朋友", "我同学", "我同事", "我家",
            "我邻居", "我舅", "我姨", "我叔", "我哥", "我姐", "我弟", "我妹"]
# 故事王：时间线索
STORY_TIME = ["三年前", "五年前", "十年前", "去年", "前年", "曾经", "以前", "小时候",
              "当时", "那年", "那时候", "上个月", "上星期", "当年", "很早以前"]
# 故事王：数字+单位（具体剂量/时长）
STORY_NUM = re.compile(r"\d+\s*(年|个月|天|周|次|粒|片|颗|毫克|克|ml|毫升|kg|公斤)")
# 故事王：情绪词
STORY_EMO = ["焦虑", "后悔", "感动", "泪", "感谢", "谢谢", "救", "害怕", "痛苦",
             "抑郁", "失眠", "绝望", "高兴", "幸福", "心疼", "欣慰", "崩溃", "难受",
             "心酸", "感动", "庆幸", "后怕"]
# 故事王：具体事例/场景
STORY_CASE = ["医院", "医生", "急诊", "检查", "手术", "吃药", "住院", "确诊",
              "被推销", "买了", "用了", "试过", "坚持", "复发", "体检"]
# 故事王：叙事转折/情境（增强真实故事识别）
STORY_TURN = ["不过", "但是", "结果", "后来", "最后", "没想到", "却", "反而", "于是",
              "每次", "经常", "后来才", "才发现", "然而"]
# 故事王：排除词（念经/推广/说教类，非亲历故事）
STORY_EXCLUDE = ["念", "诵", "咒", "佛法", "经书", "阿弥陀佛", "功德", "回向",
                 "推广", "招财", "转运", "风水", "法事", "做法事"]
# 故事王：客套感谢词（只有感谢、无实质内容 → 不构成故事）
STORY_POLITE = ["感谢", "谢谢", "多谢", "支持", "点赞", "一键三连", "学到了",
                "厉害", "顶一个", "围观", "收藏了", "辛苦了", "好人一生平安",
                "关注了", "已三连", "泪目支持"]

# 干货王：权威来源
DRY_SOURCE = ["论文", "研究", "文献", "试验", "Cochrane", "FDA", "WHO", "世卫",
              "欧洲食品安全局", "美国环保署", "EPA", "期刊", "临床", "数据",
              "统计", "meta", "荟萃分析", "随机对照", "双盲", "指南", "标准"]
# 干货王：剂量/成分/价格
DRY_DOSE = ["毫克", "克", "mg", "g", "剂量", "含量", "纯度", "原料", "胶囊", "粒",
            "元", "到手", "折扣", "成分", "配方", "kaneka", "creapure", "专利"]
# 干货王：引用/链接
DRY_LINK = re.compile(r"(http|b23\.tv|doi|pubmed|ncbi)", re.I)
# 干货王：纠错/质疑
DRY_DISPUTE = ["其实", "但是", "问题是", "不过", "不一定", "未必", "反例", "争议",
               "质疑", "不对", "错了", "误区", "被夸", "被高估", "没那么"]
# 干货王：新视角/补充
DRY_ADD = ["补充", "另外", "还有一点", "建议", "可以考虑", "提醒", "注意", "别",
           "不要", "慎用", "风险", "副作用", "禁忌"]

# 问答王：提问句式
ASK_PATTERNS = [re.compile(r"[?？]"), re.compile(r"怎么|如何|为什么|啥|哪个|多少|几"),
                re.compile(r"能.*吗|可以.*吗|有没有|是不是|该不该|要不要"),
                re.compile(r"求|求助|怎么办|请教|问问|请问|推荐|平替|替代")]

# 长文阈值
LONG_TEXT = 80


def load_csv(path):
    """读取完整评论 CSV（含回复数/UP主回复等字段）"""
    with open(path, encoding="utf-8-sig", newline="") as f:
        rows = list(csv.DictReader(f))
    out = []
    for r in rows:
        if not (r.get("评论内容") or "").strip():
            continue
        rec = {
            "rpid": int(float(r.get("评论ID") or 0)),
            "_rpid": int(float(r.get("评论ID") or 0)),
            "parent": int(float(r.get("上级评论ID") or 0)),
            "uname": r.get("用户名") or "匿名",
            "level": r.get("用户等级") or "?",
            "content": (r.get("评论内容") or "").strip(),
            "like": int(float(r.get("点赞数") or 0)),
            "reply_cnt": int(float(r.get("回复数") or 0)),
            "time": r.get("评论时间") or "",
            "ip": r.get("IP属地") or "",
            "up_replied": (r.get("UP主是否回复") or "").strip() == "是",
        }
        out.append(rec)
    return out


def hit_words(text, words):
    return [w for w in words if w in text]


def score_story(text):
    """故事王评分：亲历叙事信号"""
    s = 0
    tags = []
    # 排除项：念经/推广/说教，直接否决
    if hit_words(text, STORY_EXCLUDE):
        return 0, ["排除:非亲历"]
    if hit_words(text, STORY_ME):
        s += 2
        tags.append("第一人称")
    if hit_words(text, STORY_TIME):
        s += 2
        tags.append("时间线索")
    if STORY_NUM.search(text):
        s += 2
        tags.append("具体数字")
    emo = hit_words(text, STORY_EMO)
    if emo:
        s += 2
        tags.append("情绪:" + emo[0])
    if hit_words(text, STORY_CASE):
        s += 2
        tags.append("具体事例")
    if hit_words(text, STORY_TURN):
        s += 2
        tags.append("叙事转折")
    if len(text) >= LONG_TEXT:
        s += 1
        tags.append("长文")
    # 客套感谢排除：只说了感谢/支持，没有实质叙事信号（时间/事例/转折/数字），不算故事
    if hit_words(text, STORY_POLITE):
        has_substance = any(t in tags for t in ["时间线索", "具体事例", "叙事转折", "具体数字", "情绪:"])
        if not has_substance:
            return 0, ["排除:客套感谢"]
    return s, tags


def score_dry(text):
    """干货王评分：知识增量信号"""
    s = 0
    tags = []
    if hit_words(text, DRY_SOURCE):
        s += 2
        tags.append("权威来源")
    if hit_words(text, DRY_DOSE):
        s += 1
        tags.append("剂量/价格")
    if DRY_LINK.search(text):
        s += 2
        tags.append("引用链接")
    if hit_words(text, DRY_DISPUTE):
        s += 3  # 质疑/纠错是硬信号，权重高
        tags.append("质疑/纠错")
    if hit_words(text, DRY_ADD):
        s += 1
        tags.append("补充/提醒")
    if len(text) >= LONG_TEXT:
        s += 1
        tags.append("长文")
    return s, tags


def score_ask(text, up_replied):
    """问答王评分：求助提问 + UP回复"""
    s = 0
    tags = []
    hit = False
    for p in ASK_PATTERNS:
        if p.search(text):
            hit = True
            break
    if hit:
        s += 2
        tags.append("提问")
    if up_replied:
        s += 3
        tags.append("UP主已回复")
    if len(text) >= LONG_TEXT:
        s += 1
        tags.append("长问")
    return s, tags


def build_board(records, kind, top_n):
    """计算某榜单得分并取 TOP N"""
    board = []
    for r in records:
        if r["parent"] != 0:  # 只看一级评论
            continue
        if kind == "共鸣":
            score = r["like"] + r["reply_cnt"] * 5
            tags = [f"赞{r['like']}", f"回复{r['reply_cnt']}"]
        elif kind == "故事":
            score, tags = score_story(r["content"])
            if score < 3:  # 至少命中2个强信号
                continue
        elif kind == "干货":
            score, tags = score_dry(r["content"])
            if score < 2:
                continue
        elif kind == "问答":
            score, tags = score_ask(r["content"], r["up_replied"])
            if score < 2:
                continue
        board.append((score, r, tags))
    board.sort(key=lambda x: x[0], reverse=True)
    return board[:top_n]


def build_subtree(root_rpid, by_parent):
    """递归收集某条一级评论的完整对话树（楼中楼），返回嵌套列表"""
    nodes = []
    for child in by_parent.get(root_rpid, []):
        nodes.append(child)
        nodes.extend(build_subtree(child["_rpid"], by_parent))
    return nodes


def render_tree_line(rec, prefix, is_last, is_root=False):
    """渲染一条对话树节点"""
    branch = "└─ " if is_last else "├─ "
    reply_mark = "👑UP" if rec.get("up_replied") else ""
    head = f"{prefix}{branch}`{rec['uname']}`(lv{rec['level']}·{rec['ip']}) 👍{rec['like']} · {rec['time']} {reply_mark}"
    lines = [head]
    content = rec["content"].replace("\n", " ").strip()
    # 内容换行显示，续行用 │ 对齐
    if len(content) > 60:
        lines.append(f"{prefix}{'│  ' if not is_last else '   '}{content[:60]}…")
    else:
        lines.append(f"{prefix}{'│  ' if not is_last else '   '}{content}")
    return lines


def render_conversation(root, by_parent, max_depth=3):
    """渲染主评论的完整对话树（缩进线程结构）"""
    lines = []
    root_line = (f"┌ `{root['uname']}`(lv{root['level']}·{root['ip']}) "
                 f"👍{root['like']} 💬{root['reply_cnt']} · {root['time']} "
                 f"{'👑UP' if root.get('up_replied') else ''}")
    lines.append(f"```")
    lines.append(root_line)
    lines.append(f"│ {root['content'].replace(chr(10), ' ')[:80]}")
    if root["_rpid"] not in by_parent:
        lines.append("└─（暂无回复）")
        lines.append("```")
        return lines

    # 楼中楼按点赞降序，逐层渲染
    def walk(parent_rpid, prefix, depth):
        children = sorted(by_parent.get(parent_rpid, []),
                          key=lambda x: x["like"], reverse=True)
        for i, child in enumerate(children):
            last = (i == len(children) - 1)
            for ln in render_tree_line(child, prefix, last):
                lines.append(ln)
            if depth < max_depth:
                sub_prefix = prefix + ("   " if last else "│  ")
                walk(child["_rpid"], sub_prefix, depth + 1)

    walk(root["_rpid"], "", 1)
    lines.append("```")
    return lines


def render_md(records, top_n, title=None):
    """生成四榜 Markdown 报告（对话树结构）"""
    boards = {k: build_board(records, k, top_n) for k in ["共鸣", "故事", "干货", "问答"]}
    # 建立 parent -> children 索引
    by_parent = {}
    for r in records:
        if r["parent"] != 0:
            by_parent.setdefault(r["parent"], []).append(r)

    md = []
    md.append("# B站评论四榜报告")
    if title:
        md.append(f"\n**视频**：{title}")
    md.append(f"\n> 纯代码规则版（未调用AI）· 每榜独立评选 TOP {top_n}，不混排")
    md.append("> 共鸣=赞+回复×5 · 故事=亲历信号 · 干货=知识信号 · 问答=提问+UP回复")
    md.append("> 每条评论下方为**完整对话树**（👑UP=UP主回复过）")

    for kind, icon in [("共鸣", "🔥"), ("故事", "💭"), ("干货", "📚"), ("问答", "❓")]:
        board = boards[kind]
        md.append(f"\n---\n")
        md.append(f"## {icon} {kind}王 TOP {len(board)}")
        if not board:
            md.append("\n*本榜无符合规则的评论*")
            continue
        for i, (score, r, tags) in enumerate(board, 1):
            md.append(f"\n**#{i}** · 得分 {score} · `{r['uname']}`(lv{r['level']}·{r['ip']})")
            md.append(f" ｜ 👍{r['like']} 💬{r['reply_cnt']} ｜ {r['time']}")
            md.append(f" ｜ 信号：{' · '.join(tags)}")
            md.append(f"\n> {r['content']}\n")
            # 对话树
            tree = render_conversation(r, by_parent)
            md.append("**对话树**\n")
            md.extend(tree)
            md.append("")

    # 信号统计（供后续调整规则参考）
    md.append(f"\n---\n")
    md.append("## 信号命中统计（规则调参参考）")
    total_main = sum(1 for r in records if r["parent"] == 0)
    md.append(f"- 一级评论总数：{total_main}")
    md.append(f"- 共鸣榜入围：{len(boards['共鸣'])} · 故事榜入围：{len(boards['故事'])} · 干货榜入围：{len(boards['干货'])} · 问答榜入围：{len(boards['问答'])}")
    return "\n".join(md)


def main():
    parser = argparse.ArgumentParser(description="B站评论四榜分析（纯代码规则）")
    parser.add_argument("csv", nargs="?", help="CSV 文件路径（缺省自动找 exports/ 下最新完整CSV）")
    parser.add_argument("--top", type=int, default=10, help="每榜展示条数（默认10）")
    parser.add_argument("-o", "--out", help="输出 Markdown 路径（默认同目录）")
    args = parser.parse_args()

    if args.csv:
        csv_path = args.csv
    else:
        # 优先找最近的非速览、非列表 CSV（即完整评论 CSV）
        cands = sorted(glob.glob(os.path.join("exports", "**", "*.csv"), recursive=True),
                       key=os.path.getmtime, reverse=True)
        csv_path = None
        for c in cands:
            if "速览" in c or "列表" in c:
                continue
            csv_path = c
            break
        if not csv_path:
            print("[error] 未找到完整评论 CSV")
            sys.exit(1)

    records = load_csv(csv_path)
    if not records:
        print("[error] CSV 无有效记录")
        sys.exit(1)

    fname = os.path.splitext(os.path.basename(csv_path))[0].replace("_", " ")[:60]
    md = render_md(records, args.top, title=fname)
    out_path = args.out or os.path.splitext(csv_path)[0] + "_四榜.md"
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(md)

    print(f"读取: {csv_path}")
    print(f"评论总数: {len(records)}")
    print(f"已生成四榜报告: {out_path}（每榜 TOP {args.top}）")


if __name__ == "__main__":
    main()
