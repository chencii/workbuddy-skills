# -*- coding: utf-8 -*-
"""
B站评论精华分析器
读取 bili_comments_export.py 导出的 CSV，按过滤规则筛选精华评论，
重建完整对话树，输出 Markdown 报告。

过滤规则：剔除「低等级 且 低赞」的评论（完全筛除，不展示）：
  - 低等级判定：用户等级 <= LOW_LEVEL（默认 lv3 及以下）
  - 低赞判定：点赞数 < MIN_LIKE（默认 30）
  - 满足「低等级 AND 低赞」→ 剔除；其余（高赞 / 高等级 / 低等级高赞）→ 保留

排序：按点赞数降序展示 TOP N 条（无加权放大）。

用法:
  python bili_highlight.py [CSV文件] [--top N] [--min-like M] [--low-level L] [-o 输出.md]

示例:
  python bili_highlight.py exports/xxx.csv --top 30
  python bili_highlight.py exports/xxx.csv --top 20 --min-like 50 --low-level 3
"""
import argparse
import csv
import glob
import os
import sys


# CSV 列名（与 bili_comments_export.py 保持一致）
COLS = [
    "序号", "上级评论ID", "评论ID", "用户ID", "用户名", "用户等级", "性别",
    "评论内容", "评论时间", "回复数", "点赞数", "个性签名", "IP属地",
    "是否为大会员", "头像", "当前账号是否点赞", "UP主是否点赞", "UP主是否回复",
]


def safe_int(v, default=0):
    try:
        return int(float(v))
    except (ValueError, TypeError):
        return default


def load_csv(path):
    """读取 CSV，返回记录列表（dict），自动识别编码"""
    with open(path, encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        rows = []
        for raw in reader:
            # 跳过空行（内容为空的记录）
            if not any((raw.get(c) or "").strip() for c in COLS):
                continue
            rec = {c: (raw.get(c) or "").strip() for c in COLS}
            rec["_rpid"] = safe_int(rec["评论ID"])
            rec["_parent"] = safe_int(rec["上级评论ID"])
            rec["_like"] = safe_int(rec["点赞数"])
            rec["_level"] = safe_int(rec["用户等级"], 6) or 6  # 缺失按 lv6 保守处理
            rec["_reply_cnt"] = safe_int(rec["回复数"])
            rows.append(rec)
    return rows


def score_of(rec):
    """排序分值 = 点赞数（不做等级加权）"""
    return rec["_like"]


def build_subtree(root_rpid, by_parent):
    """递归收集某条一级评论的完整对话树（楼中楼）"""
    nodes = []
    for child in by_parent.get(root_rpid, []):
        nodes.append(child)
        nodes.extend(build_subtree(child["_rpid"], by_parent))
    return nodes


def fmt_time(t):
    return t if t else "未知"


def fmt_content(text):
    """Markdown 安全：多行内容转引用块"""
    if not text:
        return "*（无内容）*"
    lines = text.splitlines()
    if len(lines) == 1:
        return text
    return "\n".join("> " + ln for ln in lines)


def render_md(records, top_n, min_like, low_level, title=None):
    """生成 Markdown 报告内容"""
    # 分离一级评论与楼中楼
    roots = [r for r in records if r["_parent"] == 0]
    by_parent = {}
    for r in records:
        if r["_parent"] != 0:
            by_parent.setdefault(r["_parent"], []).append(r)

    # 过滤规则：剔除「低等级 且 低赞」的评论（完全筛除，不展示）
    #   低等级: level <= low_level；低赞: like < min_like
    kept = []
    dropped = 0
    for r in roots:
        if r["_level"] <= low_level and r["_like"] < min_like:
            dropped += 1
            continue
        r["_score"] = r["_like"]
        kept.append(r)
    roots = kept

    # 按点赞数降序（同分按回复数降序）
    roots.sort(key=lambda r: (r["_score"], r["_reply_cnt"]), reverse=True)
    top = roots[:top_n]

    if title is None:
        title = os.path.basename(os.path.dirname(os.path.abspath(records[0]["_src"]))) if records else "B站评论"
    md = []
    md.append(f"# 精华评论报告")
    if title:
        md.append(f"\n**视频**：{title}")
    md.append(f"\n> 过滤规则：剔除「用户等级 ≤ lv{low_level} 且 点赞 < {min_like}」的评论（共剔除 {dropped} 条）")
    md.append(f"> 剩余 {len(roots)} 条一级评论，按点赞数降序，展示 TOP {len(top)} 条（含完整对话链）")

    if not top:
        md.append("\n*没有符合条件的评论，试试调低 TOP N 或最低点赞数。*")
        return "\n".join(md)

    for i, r in enumerate(top, 1):
        replies = build_subtree(r["_rpid"], by_parent)
        md.append(f"\n---\n")
        md.append(f"## 🏆 TOP {i} · 👍 **{r['_like']}**")
        md.append(
            f"**{r['用户名'] or '匿名'}**（lv{r['_level']} · {r['性别'] or '未知'} · IP:{r['IP属地'] or '未知'}）"
            f" ｜ 💬 {r['_reply_cnt']} ｜ {fmt_time(r['评论时间'])}"
        )
        md.append(f"\n{r['评论内容']}\n")
        if replies:
            # 楼中楼按时间排序展示
            replies_sorted = sorted(replies, key=lambda x: x["评论时间"])
            md.append(f"**对话链（{len(replies)} 条回复）**\n")
            for sub in replies_sorted:
                md.append(
                    f"- `{sub['用户名'] or '匿名'}`（lv{sub['_level']} · {sub['性别'] or '未知'}）"
                    f" 👍{sub['_like']} · {fmt_time(sub['评论时间'])}"
                )
                md.append(f"\n  > {fmt_content(sub['评论内容'])}\n")
    return "\n".join(md)


def main():
    parser = argparse.ArgumentParser(description="B站评论精华分析器")
    parser.add_argument("csv", nargs="?", help="CSV 文件路径（缺省自动找 exports/ 下最新）")
    parser.add_argument("--top", type=int, default=20, help="展示 TOP N 条精华（默认 20）")
    parser.add_argument("--min-like", type=int, default=30, help="低赞判定：点赞数低于此值视为低赞（默认 30）")
    parser.add_argument("--low-level", type=int, default=3, help="低等级判定：等级低于等于此值视为低等级（默认 3）")
    parser.add_argument("-o", "--out", help="输出 Markdown 路径（默认同目录）")
    args = parser.parse_args()

    # 定位 CSV
    if args.csv:
        csv_path = args.csv
    else:
        exports = sorted(glob.glob(os.path.join("exports", "*.csv")), key=os.path.getmtime, reverse=True)
        if not exports:
            print("[error] 未找到 CSV 文件，请指定路径")
            sys.exit(1)
        csv_path = exports[0]
    if not os.path.exists(csv_path):
        print(f"[error] 文件不存在: {csv_path}")
        sys.exit(1)

    records = load_csv(csv_path)
    if not records:
        print("[error] CSV 为空或无有效记录")
        sys.exit(1)

    # 视频标题取文件名前缀
    fname = os.path.splitext(os.path.basename(csv_path))[0]
    title = fname.replace("_", " ")[:60]
    for rec in records:
        rec["_src"] = csv_path

    out_path = args.out or os.path.splitext(csv_path)[0] + "_精华.md"
    md = render_md(records, args.top, args.min_like, args.low_level, title=title)
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(md)

    roots = [r for r in records if r["_parent"] == 0]
    dropped = sum(1 for r in roots if r["_level"] <= args.low_level and r["_like"] < args.min_like)
    print(f"读取: {csv_path}")
    print(f"评论总数: {len(records)}（一级 {len(roots)} / 楼中楼 {len(records)-len(roots)}）")
    print(f"剔除「lv≤{args.low_level} 且 赞<{args.min_like}」评论: {dropped} 条")
    print(f"已生成精华报告: {out_path}")
    print(f"（TOP {args.top} 条，按点赞降序）")


if __name__ == "__main__":
    main()
