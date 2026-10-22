# -*- coding: utf-8 -*-
"""
B站评论导出（增强版）
基于 1dyer/bilibili-comment-crawler 改进：
  - BV 号命令行传参，支持一次多个视频
  - wbi 密钥动态获取 + 内置兜底
  - 修复二级评论字段引用 bug
  - 输出统一到 exports/ 目录
  - 抓取完成后自动生成"精华评论"Markdown 报告（可关）

用法:
  python bili_comments_export.py BV1xxxx BV1yyyy [选项]

选项:
  --no-second        只爬一级评论，不爬楼中楼（默认爬）
  --no-highlight     不生成精华评论报告（默认生成）
  --top N            精华报告 TOP N 条（默认 20）
  --min-like M       低赞判定：点赞<此值视为低赞（默认 30）
  --low-level L      低等级判定：等级≤此值视为低等级（默认 3）

精华报告过滤规则：
  剔除「用户等级 ≤ low-level 且 点赞 < min-like」的评论（完全筛除，不展示）
  其余（高赞 / 高等级 / 低等级高赞）按点赞数降序展示，含完整对话链
"""
import argparse
import csv
import hashlib
import json
import os
import random
import re
import sys
import time
import urllib.parse

import requests
import pandas as pd

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
EXPORT_DIR = os.path.join(BASE_DIR, "exports")
# 允许通过环境变量覆盖输出目录（用于把产物放到工作区可见文件夹）
EXPORT_DIR = os.environ.get("BILI_OUTDIR", EXPORT_DIR)
COOKIE_FILE = os.path.join(BASE_DIR, "bili_cookie.txt")
FALLBACK_MIXIN_KEY = "ea1db124af3c7062474693fa704f4ff8"
MIXIN_KEY_TAB = [
    46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35,
    27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13,
    37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4,
    22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52,
]

_session = requests.Session()
_mixin_key = None


def get_headers():
    cookie = ""
    if os.path.exists(COOKIE_FILE):
        with open(COOKIE_FILE, "r") as f:
            cookie = f.read().strip()
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/126.0.0.0 Safari/537.36"
        ),
        "Referer": "https://www.bilibili.com/",
    }
    if cookie:
        headers["Cookie"] = cookie
    return headers


def get_mixin_key():
    """从 nav 接口动态获取 wbi mixin key，失败返回内置密钥"""
    try:
        resp = _session.get(
            "https://api.bilibili.com/x/web-interface/nav",
            headers=get_headers(),
            timeout=10,
        )
        data = resp.json()
        img_url = data["data"]["wbi_img"]["img_url"]
        sub_url = data["data"]["wbi_img"]["sub_url"]
        img_key = img_url.rsplit("/", 1)[1].split(".")[0]
        sub_key = sub_url.rsplit("/", 1)[1].split(".")[0]
        raw = img_key + sub_key
        mixin = "".join(raw[i] for i in MIXIN_KEY_TAB)[:32]
        return mixin
    except Exception as e:
        print(f"[warn] 动态获取 wbi 密钥失败({e})，使用内置密钥")
        return FALLBACK_MIXIN_KEY


def md5(code):
    return hashlib.md5(code.encode("utf-8")).hexdigest()


def fetch_json(url, timeout=15):
    resp = _session.get(url, headers=get_headers(), timeout=timeout)
    return json.loads(resp.content.decode("utf-8"))


def get_information(bv, flag=1):
    """通过 bv 号获取 oid 和标题"""
    if flag == 1:
        resp = _session.get(f"https://www.bilibili.com/video/{bv}", headers=get_headers())
    elif flag == 2:
        resp = _session.get(f"https://www.bilibili.com/bangumi/play/{bv}", headers=get_headers())
    else:
        resp = _session.get(f"https://www.bilibili.com/opus/{bv}", headers=get_headers())

    if flag == 1:
        obj = re.compile(f'"aid":(?P<id>.*?),"bvid":"{bv}"')
        oid = obj.search(resp.text).group("id")
    elif flag == 2:
        oid = re.findall(r'aid":(.+?),', resp.text)[0]
    else:
        oid = re.findall(r'"rid_str":"(.+?)"', resp.text)[0]

    try:
        title = re.findall(r"<title>(.+?)</title>", resp.text)[0]
    except Exception:
        title = "未识别"
    return oid, title


def cool_down(count, min_sec, max_sec, cd_flag):
    if cd_flag == 1:
        page_cd = random.uniform(min_sec, max_sec)
        print(f"爬虫已进入下一页，为避免触发反爬机制，暂停 {page_cd:.1f} 秒...")
        time.sleep(page_cd)
    elif cd_flag == 2:
        comment_cd = random.uniform(min_sec, max_sec)
        print(f"已爬取 {count} 条评论，为避免触发反爬机制，暂停 {comment_cd:.1f} 秒...")
        time.sleep(comment_cd)


def build_main_url(oid, pageID, mode, type_, flag):
    """构造一级评论 wbi/main 请求 URL"""
    wts = int(time.time())
    if pageID != "":
        pagination_str = '{"offset":"%s"}' % pageID
        code = (
            f"mode={mode}&oid={oid}&pagination_str={urllib.parse.quote(pagination_str, safe='')}"
            f"&plat=1&type={type_}&web_location=1315875&wts={wts}"
        ) + _mixin_key
        w_rid = md5(code)
        url = (
            f"https://api.bilibili.com/x/v2/reply/wbi/main?oid={oid}&type={type_}&mode={mode}"
            f"&pagination_str={urllib.parse.quote(pagination_str, safe=':')}&plat=1&web_location=1315875"
            f"&w_rid={w_rid}&wts={wts}"
        )
    else:
        pagination_str = '{"offset":""}'
        code = (
            f"mode={mode}&oid={oid}&pagination_str={urllib.parse.quote(pagination_str, safe='')}"
            f"&plat=1&seek_rpid=&type={type_}&web_location=1315875&wts={wts}"
        ) + _mixin_key
        w_rid = md5(code)
        url = (
            f"https://api.bilibili.com/x/v2/reply/wbi/main?oid={oid}&type={type_}&mode={mode}"
            f"&pagination_str={urllib.parse.quote(pagination_str, safe=':')}&plat=1&seek_rpid="
            f"&web_location=1315875&w_rid={w_rid}&wts={wts}"
        )
    return url


def parse_reply(reply):
    """把一条评论解析成 CSV 行数据"""
    try:
        parent = reply["parent"]
    except Exception:
        parent = 0
    try:
        rpid = reply["rpid"]
    except Exception:
        rpid = 0
    try:
        uid = reply["mid"]
    except Exception:
        uid = ""
    try:
        name = reply["member"]["uname"]
    except Exception:
        name = ""
    try:
        level = reply["member"]["level_info"]["current_level"]
    except Exception:
        level = ""
    try:
        sex = reply["member"]["sex"]
    except Exception:
        sex = ""
    try:
        avatar = reply["member"]["avatar"]
    except Exception:
        avatar = ""
    try:
        vip = "是" if reply["member"]["vip"]["vipStatus"] != 0 else "否"
    except Exception:
        vip = "否"
    try:
        IP = reply["reply_control"]["location"][5:]
    except Exception:
        IP = "未知"
    try:
        context = reply["content"]["message"]
    except Exception:
        context = ""
    try:
        reply_time = pd.to_datetime(reply["ctime"], unit="s")
    except Exception:
        reply_time = ""
    try:
        rereply = reply["reply_control"]["sub_reply_entry_text"]
        rereply = int(re.findall(r"\d+", rereply)[0])
    except Exception:
        rereply = 0
    try:
        like = reply["like"]
    except Exception:
        like = 0
    try:
        sign = reply["member"]["sign"]
    except Exception:
        sign = ""
    try:
        action = "是" if reply["action"] == 1 else "否"
    except Exception:
        action = "否"
    try:
        up_action = "是" if reply["up_action"]["like"] else "否"
    except Exception:
        up_action = "否"
    try:
        up_reply = "是" if reply["up_action"]["reply"] else "否"
    except Exception:
        up_reply = "否"
    return [
        parent, rpid, uid, name, level, sex, context, reply_time,
        rereply, like, sign, IP, vip, avatar, action, up_action, up_reply,
    ]


def fetch_main_comments(oid, pageID, mode, type_, count, csv_writer, is_second, bv):
    """抓取一页一级评论及其二级评论，返回 (next_pageID, count)"""
    url = build_main_url(oid, pageID, mode, type_, 1)
    comment = fetch_json(url)

    replies = (comment.get("data") or {}).get("replies") or []
    for reply in replies:
        count += 1
        row = parse_reply(reply)
        csv_writer.writerow([count] + row)

        # 每 1000 条冷却一次
        if count % 1000 == 0:
            cool_down(count, 30, 60, 2)

        # 二级评论
        if is_second and row[8] != 0:
            rpid = reply["rpid"]
            total_pages = (row[8] - 1) // 10 + 2
            for page in range(1, total_pages):
                second_url = (
                    f"https://api.bilibili.com/x/v2/reply/reply?oid={oid}&type=1"
                    f"&root={rpid}&ps=10&pn={page}&web_location=333.788"
                )
                second_comment = fetch_json(second_url)
                second_replies = (second_comment.get("data") or {}).get("replies") or []
                if not second_replies:
                    break
                for second in second_replies:
                    count += 1
                    srow = parse_reply(second)
                    csv_writer.writerow([count] + srow)
                    if count % 1000 == 0:
                        cool_down(count, 30, 60, 2)
                time.sleep(random.uniform(0.2, 0.8))

    # 下一页游标
    try:
        next_pageID = comment["data"]["cursor"]["pagination_reply"]["next_offset"]
    except Exception:
        next_pageID = 0
    return next_pageID, count


def crawl_video(bv, is_second):
    """爬取单个视频的全部评论，导出 CSV"""
    print(f"\n===== 开始处理 {bv} =====")
    try:
        oid, title = get_information(bv)
    except Exception as e:
        print(f"[error] 获取视频信息失败({e})，跳过 {bv}")
        return
    print(f"目标：{title}  (oid={oid})")

    os.makedirs(EXPORT_DIR, exist_ok=True)
    safe_title = re.sub(r'[\\/:*?"<>|\n\r]', "_", title)[:30]
    out_path = os.path.join(EXPORT_DIR, f"{safe_title}_{bv}.csv")

    mode = 2  # 2=最新评论, 3=热门评论
    count = 0
    next_pageID = ""

    with open(out_path, "w", newline="", encoding="utf-8-sig") as f:
        csv_writer = csv.writer(f)
        csv_writer.writerow([
            "序号", "上级评论ID", "评论ID", "用户ID", "用户名", "用户等级", "性别",
            "评论内容", "评论时间", "回复数", "点赞数", "个性签名", "IP属地",
            "是否为大会员", "头像", "当前账号是否点赞", "UP主是否点赞", "UP主是否回复",
        ])
        while next_pageID != 0:
            try:
                next_pageID, count = fetch_main_comments(
                    oid, next_pageID, mode, 1, count, csv_writer, is_second, bv
                )
            except Exception as e:
                print(f"[error] 翻页失败({e})，等待 5 秒重试...")
                time.sleep(5)
                continue
            if next_pageID != 0:
                print(f"当前已爬取 {count} 条。")
                cool_down(count, 1, 10, 1)

    print(f"完成！{bv} 共 {count} 条评论 → {out_path}")
    return out_path


# ==================== 精华评论分析（集成自 bili_highlight.py） ====================

def load_csv(path):
    """读取 CSV，返回记录列表（dict），自动识别编码"""
    cols = ["序号", "上级评论ID", "评论ID", "用户ID", "用户名", "用户等级", "性别",
            "评论内容", "评论时间", "回复数", "点赞数", "个性签名", "IP属地",
            "是否为大会员", "头像", "当前账号是否点赞", "UP主是否点赞", "UP主是否回复"]
    with open(path, encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        rows = []
        for raw in reader:
            if not any((raw.get(c) or "").strip() for c in cols):
                continue
            rec = {c: (raw.get(c) or "").strip() for c in cols}
            rec["_rpid"] = int(float(rec["评论ID"]) or 0)
            rec["_parent"] = int(float(rec["上级评论ID"]) or 0)
            rec["_like"] = int(float(rec["点赞数"]) or 0)
            rec["_level"] = int(float(rec["用户等级"]) or 6) or 6  # 缺失按 lv6 保守处理
            rec["_reply_cnt"] = int(float(rec["回复数"]) or 0)
            rows.append(rec)
    return rows


def build_subtree(root_rpid, by_parent):
    """递归收集某条一级评论的完整对话树（楼中楼）"""
    nodes = []
    for child in by_parent.get(root_rpid, []):
        nodes.append(child)
        nodes.extend(build_subtree(child["_rpid"], by_parent))
    return nodes


def fmt_hl_time(t):
    return t if t else "未知"


def fmt_hl_content(text):
    """Markdown 安全：多行内容转引用块"""
    if not text:
        return "*（无内容）*"
    lines = text.splitlines()
    if len(lines) == 1:
        return text
    return "\n".join("> " + ln for ln in lines)


def generate_highlight(csv_path, top_n=20, min_like=30, low_level=3, title=None):
    """
    从 CSV 生成精华评论 Markdown 报告。
    过滤规则：剔除「用户等级 ≤ low_level 且 点赞 < min_like」的评论（完全筛除）。
    返回报告路径；无数据时返回 None。
    """
    records = load_csv(csv_path)
    if not records:
        print("[warn] CSV 为空，跳过精华分析")
        return None

    roots = [r for r in records if r["_parent"] == 0]
    by_parent = {}
    for r in records:
        if r["_parent"] != 0:
            by_parent.setdefault(r["_parent"], []).append(r)

    # 过滤：剔除「低等级 且 低赞」
    kept, dropped = [], 0
    for r in roots:
        if r["_level"] <= low_level and r["_like"] < min_like:
            dropped += 1
            continue
        kept.append(r)
    roots = kept

    # 按点赞数降序（同分按回复数）
    roots.sort(key=lambda r: (r["_like"], r["_reply_cnt"]), reverse=True)
    top = roots[:top_n]

    if title is None:
        title = os.path.splitext(os.path.basename(csv_path))[0].replace("_", " ")[:60]

    md = []
    md.append("# 精华评论报告")
    if title:
        md.append(f"\n**视频**：{title}")
    md.append(f"\n> 过滤规则：剔除「用户等级 ≤ lv{low_level} 且 点赞 < {min_like}」的评论（共剔除 {dropped} 条）")
    md.append(f"> 剩余 {len(roots)} 条一级评论，按点赞数降序，展示 TOP {len(top)} 条（含完整对话链）")

    if top:
        for i, r in enumerate(top, 1):
            replies = build_subtree(r["_rpid"], by_parent)
            md.append(f"\n---\n")
            md.append(f"## 🏆 TOP {i} · 👍 **{r['_like']}**")
            md.append(
                f"**{r['用户名'] or '匿名'}**（lv{r['_level']} · {r['性别'] or '未知'} · IP:{r['IP属地'] or '未知'}）"
                f" ｜ 💬 {r['_reply_cnt']} ｜ {fmt_hl_time(r['评论时间'])}"
            )
            md.append(f"\n{r['评论内容']}\n")
            if replies:
                replies_sorted = sorted(replies, key=lambda x: x["评论时间"])
                md.append(f"**对话链（{len(replies)} 条回复）**\n")
                for sub in replies_sorted:
                    md.append(
                        f"- `{sub['用户名'] or '匿名'}`（lv{sub['_level']} · {sub['性别'] or '未知'}）"
                        f" 👍{sub['_like']} · {fmt_hl_time(sub['评论时间'])}"
                    )
                    md.append(f"\n  > {fmt_hl_content(sub['评论内容'])}\n")
    else:
        md.append("\n*没有符合条件的评论，试试调低 TOP N 或最低点赞数。*")

    out_path = os.path.splitext(csv_path)[0] + "_精华.md"
    with open(out_path, "w", encoding="utf-8") as f:
        f.write("\n".join(md))
    print(f"精华报告: {out_path}（剔除 {dropped} 条低等级低赞，TOP {len(top)}）")
    return out_path


def main():
    parser = argparse.ArgumentParser(description="B站评论导出（含精华分析）")
    parser.add_argument("bvs", nargs="+", help="一个或多个视频 BV 号")
    parser.add_argument("--no-second", action="store_true", help="不爬取楼中楼")
    parser.add_argument("--no-highlight", action="store_true", help="不生成精华评论报告")
    parser.add_argument("--top", type=int, default=20, help="精华报告 TOP N 条（默认 20）")
    parser.add_argument("--min-like", type=int, default=30, help="低赞判定：点赞<此值视为低赞（默认 30）")
    parser.add_argument("--low-level", type=int, default=3, help="低等级判定：等级≤此值视为低等级（默认 3）")
    args = parser.parse_args()

    global _mixin_key
    _mixin_key = get_mixin_key()
    print(f"wbi 密钥: {_mixin_key[:8]}...{_mixin_key[-4:]}")

    if not os.path.exists(COOKIE_FILE) or not open(COOKIE_FILE).read().strip():
        print("[warn] bili_cookie.txt 为空！未登录可能只能抓到少量评论，建议先配置 Cookie")

    for bv in args.bvs:
        out_path = crawl_video(bv, not args.no_second)
        if out_path and not args.no_highlight:
            try:
                generate_highlight(
                    out_path, top_n=args.top, min_like=args.min_like,
                    low_level=args.low_level,
                    title=f"BV号 {bv} 评论区精华",
                )
            except Exception as e:
                print(f"[warn] 精华分析失败({e})")

    print("\n全部完成！CSV 与精华报告已保存到 exports/ 目录。")


if __name__ == "__main__":
    main()
