#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""B 站字幕下载器 (stdlib only)

输入: B 站视频链接 / BV 号 / av 号
输出: 字幕 TXT 文件 (默认纯文本, 可选时间戳)

说明:
- 通过 WBI 签名调用 api.bilibili.com/x/player/wbi/v2 获取字幕列表。
- 该接口在无登录时大多返回空字幕, 需要用户提供 B 站 SESSDATA Cookie。
- 字幕 JSON 文件本身下载通常不需要 Cookie。
"""
import sys
import os
import re
import json
import time
import argparse
import hashlib
import urllib.parse
import urllib.request

API = "https://api.bilibili.com"
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120.0 Safari/537.36")
REFERER = "https://www.bilibili.com"

COOKIE = ""  # 运行时由 --cookie / 环境变量 / cookie 文件注入
SKILL_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_COOKIE_FILE = os.path.join(SKILL_DIR, ".cookie")
_nav = None  # nav 接口响应缓存, 供登录态检查复用

# ------------------------- 网络层 -------------------------
def http_get_json(url, params=None):
    if params:
        url += "?" + urllib.parse.urlencode(sorted(params.items()))
    headers = {"User-Agent": UA, "Referer": REFERER}
    if COOKIE:
        headers["Cookie"] = COOKIE
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode("utf-8"))


# ------------------------- WBI 签名 -------------------------
_wbi_cache = None


def wbi_keys():
    global _wbi_cache, _nav
    if _wbi_cache:
        return _wbi_cache
    if _nav is None:
        _nav = http_get_json(API + "/x/web-interface/nav")
    d = _nav
    img = d["data"]["wbi_img"]["img_url"].split("/")[-1].split(".")[0]
    sub = d["data"]["wbi_img"]["sub_url"].split("/")[-1].split(".")[0]
    _wbi_cache = (img, sub)
    return _wbi_cache


MIXIN_TABLE = [46,47,18,2,53,8,23,32,15,50,10,31,58,3,45,35,27,43,5,49,33,9,42,
               19,29,28,14,39,12,38,41,13,37,48,7,16,24,55,40,61,26,17,0,1,60,
               51,30,4,22,25,54,21,56,59,6,63,57,62,11,36,20,34,44,52]


def mixin_key(img, sub):
    s = img + sub
    return "".join(s[i] for i in MIXIN_TABLE)[:32]


def wbi_sign(params):
    img, sub = wbi_keys()
    mk = mixin_key(img, sub)
    params["w_ts"] = int(time.time())
    q = urllib.parse.urlencode(sorted(params.items()))
    params["w_rid"] = hashlib.md5((mk + q).encode()).hexdigest()
    return params


# ------------------------- 解析输入 -------------------------
def parse_bvid(link):
    link = link.strip()
    m = re.search(r"BV[0-9A-Za-z]+", link)
    if m:
        return m.group(0)
    m = re.search(r"av(\d+)", link, re.I)
    if m:
        return "av" + m.group(1)
    raise ValueError("无法从输入中解析出 BV/av 号: " + link)


def resolve_b23(link):
    """处理 b23.tv 短链, 返回最终 URL 中的 BV 号。"""
    if "b23.tv" not in link:
        return parse_bvid(link)
    # 手动跟随重定向拿到 Location
    from urllib.parse import urlparse
    host = urlparse(link).netloc
    try:
        import http.client
        conn = http.client.HTTPSConnection(host, timeout=15)
        conn.request("GET", urlparse(link).path or "/", headers={"User-Agent": UA})
        resp = conn.getresponse()
        loc = resp.getheader("Location")
        conn.close()
        if loc:
            return parse_bvid(loc)
    except Exception:
        pass
    raise ValueError("无法解析 b23.tv 短链: " + link)


# ------------------------- 获取分 P -------------------------
def get_pages(bvid):
    if bvid.lower().startswith("av"):
        d = http_get_json(API + "/x/web-interface/view", {"aid": bvid[2:]})
    else:
        d = http_get_json(API + "/x/web-interface/view", {"bvid": bvid})
    data = d["data"]
    title = data["title"]
    pages = [(p["cid"], p.get("part") or title)
             for p in data.get("pages", [{"cid": data["cid"], "part": title}])]
    return title, pages


# ------------------------- 获取字幕列表 -------------------------
def get_subtitles(bvid, cid):
    params = {"bvid": bvid, "cid": str(cid)}
    wbi_sign(params)
    d = http_get_json(API + "/x/player/wbi/v2", params)
    return d.get("data", {}).get("subtitle", {}).get("subtitles", [])


def pick_lang(subs, pref):
    if pref:
        for s in subs:
            if s["lan"] == pref:
                return s
        sys.stderr.write(f"[warn] 指定语言 {pref} 不存在, 可用: "
                         f"{[s['lan'] for s in subs]}\n")
    order = ["zh-CN", "zh-Hans", "ai-zh", "cn", "zh", "ai-zh-CN"]
    for lan in order:
        for s in subs:
            if s["lan"] == lan:
                return s
    return subs[0] if subs else None


# ------------------------- 下载并解析字幕 -------------------------
def download_subtitle_json(url):
    if url.startswith("//"):
        url = "https:" + url
    headers = {"User-Agent": UA, "Referer": REFERER}
    if COOKIE:
        headers["Cookie"] = COOKIE
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode("utf-8"))


def fmt(sec):
    sec = float(sec)
    h = int(sec // 3600)
    m = int((sec % 3600) // 60)
    s = sec % 60
    if h > 0:
        return f"{h:02}:{m:02}:{s:05.2f}"
    return f"{m:02}:{s:05.2f}"


def to_text(sub_json, timestamps):
    lines = []
    for item in sub_json.get("body", []):
        content = (item.get("content") or "").strip()
        if not content:
            continue
        if timestamps:
            lines.append(f"[{fmt(item.get('from', 0))} --> {fmt(item.get('to', 0))}] {content}")
        else:
            lines.append(content)
    return "\n".join(lines)


def safe_name(s):
    s = re.sub(r'[\\/:*?"<>|\r\n\t]+', "_", s)
    return s.strip(". ")[:80] or "subtitle"


# ------------------------- Cookie 有效期与登录态检查 -------------------------
def extract_sessdata(cookie_str):
    m = re.search(r"SESSDATA=([^;\s]+)", cookie_str)
    return m.group(1) if m else None


def sessdata_expiry(cookie_str):
    """从 SESSDATA 值中解析过期时间戳 (第二段, 逗号分隔)。"""
    s = extract_sessdata(cookie_str)
    if not s:
        return None
    try:
        dec = urllib.parse.unquote(s)
        fields = dec.split(",")
        if len(fields) >= 2:
            return int(fields[1])
    except Exception:
        pass
    return None


def check_cookie_status():
    """返回 (ok, msg)。ok=False 表示 Cookie 缺失或已失效。不输出 Cookie 值本身。"""
    if not COOKIE:
        return False, "未提供 Cookie（多数视频无法获取字幕列表，提供方式见 SKILL.md）"
    msgs = []
    exp = sessdata_expiry(COOKIE)
    if exp:
        days = (exp - time.time()) / 86400.0
        fmt = time.strftime("%Y-%m-%d", time.localtime(exp))
        if days < 0:
            msgs.append(f"⚠️ SESSDATA 已于 {fmt} 过期，已失效，请更换！")
        elif days < 7:
            msgs.append(f"⚠️ SESSDATA 将于 {fmt} 过期（剩 {days:.0f} 天），请提前更换")
        else:
            msgs.append(f"SESSDATA 有效期至 {fmt}（剩 {days:.0f} 天）")
    else:
        msgs.append("SESSDATA 有效期无法解析，以实际登录态为准")
    try:
        global _nav
        if _nav is None:
            _nav = http_get_json(API + "/x/web-interface/nav")
        u = _nav.get("data", {})
        if u.get("isLogin"):
            msgs.append(f"登录态正常：{u.get('uname', '')} (UID {u.get('mid', '')})")
            return True, "；".join(msgs)
        msgs.append("⚠️ 接口未识别为登录态，Cookie 可能已失效")
        return False, "；".join(msgs)
    except Exception as e:
        msgs.append(f"登录态检查失败: {e}")
        return False, "；".join(msgs)


# ------------------------- 主流程 -------------------------
def main():
    global COOKIE
    ap = argparse.ArgumentParser(description="B 站字幕下载器 -> TXT")
    ap.add_argument("link", nargs="?", help="视频链接 / BV 号 / av 号 / b23.tv 短链")
    ap.add_argument("-o", "--out", default=".", help="输出目录 (默认当前目录)")
    ap.add_argument("-l", "--lang", default=None, help="指定字幕语言代码, 如 zh-CN / ai-zh")
    ap.add_argument("-t", "--timestamps", action="store_true", help="输出带时间戳")
    ap.add_argument("-c", "--cookie", default=None, help="B 站 Cookie (含 SESSDATA=...)")
    ap.add_argument("--cookie-file", default=None, help="从文件读取 Cookie")
    ap.add_argument("--check", action="store_true", help="仅检查 Cookie 有效期与登录态后退出")
    args = ap.parse_args()

    if not args.check and not args.link:
        ap.error("缺少视频链接参数")

    # Cookie 来源优先级: 参数 > 文件 > 环境变量 > skill 默认 .cookie
    if args.cookie:
        COOKIE = args.cookie
    elif args.cookie_file:
        with open(os.path.expanduser(args.cookie_file), "r", encoding="utf-8") as f:
            COOKIE = f.read().strip()
    elif os.environ.get("BILI_COOKIE"):
        COOKIE = os.environ["BILI_COOKIE"].strip()
    elif os.path.exists(DEFAULT_COOKIE_FILE):
        with open(DEFAULT_COOKIE_FILE, "r", encoding="utf-8") as f:
            COOKIE = f.read().strip()

    ok, status_msg = check_cookie_status()
    print("Cookie:", status_msg)
    if args.check:
        sys.exit(0 if ok else 1)

    bvid = resolve_b23(args.link)
    title, pages = get_pages(bvid)
    print(f"视频: {title}  ({bvid})  共 {len(pages)} P")

    os.makedirs(args.out, exist_ok=True)
    written = []

    for idx, (cid, part) in enumerate(pages, 1):
        subs = get_subtitles(bvid, cid)
        if not subs:
            print(f"  P{idx} [{part}]: 未获取到字幕"
                  + ("" if COOKIE else " (提示: 未提供 Cookie, 多数视频需登录才能列出字幕)"))
            continue

        print(f"  P{idx} [{part}] 可用字幕: " + ", ".join(
            f"{s['lan']}({s.get('lan_doc','')})" for s in subs))
        sub = pick_lang(subs, args.lang)
        print(f"    选用: {sub['lan']} ({sub.get('lan_doc','')})")
        sub_json = download_subtitle_json(sub["subtitle_url"])
        text = to_text(sub_json, args.timestamps)

        suffix = f"_p{idx}" if len(pages) > 1 else ""
        fname = f"{safe_name(title)}{suffix}.txt"
        path = os.path.join(args.out, fname)
        with open(path, "w", encoding="utf-8") as f:
            f.write(text + "\n")
        written.append(path)
        print(f"    已写出: {path}  ({len(text.splitlines())} 行)")

    if written:
        print("\n完成, 共写出 " + str(len(written)) + " 个文件:")
        for p in written:
            print("  " + p)
    else:
        print("\n未写出任何字幕文件。若视频确有字幕, 请通过 -c/--cookie 提供 B 站 "
              "SESSDATA Cookie 后重试 (获取方式见 SKILL.md)。")
        sys.exit(2)


if __name__ == "__main__":
    main()
