# -*- coding: utf-8 -*-
"""
B站 UP 主视频列表 + 批量评论导出
输入 UP 主名字 → 搜索 UID → 拉取全部视频列表（按点赞排序）→ 可选批量导出每个视频的评论

用法:
  1. 只拉视频列表:
     python bili_up_videos.py "UP主名字"
     python bili_up_videos.py "UP主名字" --order like      # 按点赞排序（默认）
     python bili_up_videos.py "UP主名字" --order pubdate   # 按发布时间
     python bili_up_videos.py "UP主名字" --order click     # 按播放量
     输出: exports/{UP主}_视频列表.csv

  2. 列表 + 批量导出全部评论:
     python bili_up_videos.py "UP主名字" --export
     python bili_up_videos.py "UP主名字" --export --start 11 --end 20   # 只导出列表中第 11~20 个视频
     每个视频产出: exports/{UP主}/{标题}_{bvid}.csv + _精华.md

  断点续跑: 中途 Ctrl+C 后，重新运行同样命令，已完成的视频会自动跳过（检测输出文件是否存在）。
"""
import argparse
import csv
import glob
import os
import re
import sys
import time
import urllib.parse
import hashlib
import requests

import bili_comments_export as b

EXPORT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "exports")


def search_uid(keyword):
    """按名字搜索 UP 主，返回 (uid, uname, fans)"""
    r = requests.get(
        "https://api.bilibili.com/x/web-interface/search/type",
        params={"search_type": "bili_user", "keyword": keyword},
        headers=b.get_headers(), timeout=10,
    ).json()
    if r.get("code") != 0 or not r.get("data", {}).get("result"):
        return None
    u = r["data"]["result"][0]
    return u.get("mid"), u.get("uname"), u.get("fans")


def fetch_video_page(mid, pn, ps=50, order="like"):
    """拉取一页视频列表"""
    wts = int(time.time())
    params = {
        "mid": mid, "ps": ps, "pn": pn, "order": order,
        "platform": "web", "web_location": "1550101", "wts": wts,
    }
    signed = {k: str(v) for k, v in params.items() if str(v) != ""}
    query = "&".join(
        f"{k}={urllib.parse.quote(str(v), safe='')}" for k, v in sorted(signed.items())
    )
    w_rid = hashlib.md5((query + b._mixin_key).encode()).hexdigest()
    signed["w_rid"] = w_rid
    r = requests.get(
        "https://api.bilibili.com/x/space/wbi/arc/search",
        params=signed, headers=b.get_headers(), timeout=10,
    ).json()
    return r


def fetch_all_videos(mid, order="like", max_pages=60):
    """拉取 UP 主全部视频，返回 (vlist, total)"""
    vlist = []
    total = 0
    for pn in range(1, max_pages + 1):
        r = fetch_video_page(mid, pn, order=order)
        if r.get("code") != 0:
            if pn == 1:
                print(f"[error] 视频列表接口失败: {r.get('code')} {r.get('message')}")
            break
        data = r["data"]
        total = data.get("page", {}).get("count", 0)
        page = data.get("list", {}).get("vlist", [])
        if not page:
            break
        vlist.extend(page)
        print(f"  第 {pn} 页: {len(page)} 条（累计 {len(vlist)} / {total}）")
        if len(vlist) >= total:
            break
        time.sleep(0.3)
    return vlist, total


def save_video_list(vlist, uname, order):
    """保存视频列表 CSV"""
    os.makedirs(EXPORT_DIR, exist_ok=True)
    safe_name = re.sub(r'[\\/:*?"<>|\n\r]', "_", uname)
    out = os.path.join(EXPORT_DIR, f"{safe_name}_视频列表.csv")
    with open(out, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f)
        w.writerow(["序号", "BV号", "AV号", "标题", "发布时间", "播放量", "评论数", "弹幕数", "时长", "分区"])
        for i, v in enumerate(vlist, 1):
            w.writerow([
                i, v["bvid"], v["aid"], v["title"],
                time.strftime("%Y-%m-%d", time.localtime(v["created"])),
                v.get("play", 0), v.get("comment", 0), v.get("video_review", 0),
                v.get("length", ""), v.get("type_name", ""),
            ])
    order_name = {"like": "点赞数", "pubdate": "发布时间", "click": "播放量"}[order]
    print(f"\n视频列表已保存: {out}（共 {len(vlist)} 个视频，按{order_name}降序）")
    print("（注：列表接口不返回点赞数明细，按点赞排序时以排序序号为准）")
    return out


def preview_highlights(vlist, top_per_video=3, min_like=5, limit=0):
    """
    快速浏览每个视频的高赞评论（mode=3 热门排序第一页），生成速览报告。
    每个视频只发 1 次请求，可大幅节省时间；输出 exports/{UP主}_高赞评论速览.md
    返回报告路径。
    """
    if limit > 0:
        vlist = vlist[:limit]
    print(f"\n===== 快速浏览高赞评论: {len(vlist)} 个视频（每视频取 top {top_per_video}，赞≥{min_like}） =====")
    os.makedirs(EXPORT_DIR, exist_ok=True)

    md = []
    md.append("# UP主高赞评论速览")
    md.append(f"\n> 共浏览 {len(vlist)} 个视频，每个视频取点赞最高的 {top_per_video} 条评论（点赞≥{min_like}）")
    md.append(f"> 生成时间：{time.strftime('%Y-%m-%d %H:%M:%S')}")
    md.append("\n> 用途：快速判断哪些视频的评论区值得完整导出。看中哪个视频，记下它的 BV 号即可。")

    csv_rows = []
    got = 0
    for idx, v in enumerate(vlist, 1):
        bvid, title = v["bvid"], v["title"]
        oid = v["aid"]
        try:
            url = b.build_main_url(str(oid), "", 3, 1, 1)  # mode=3 热门排序第一页
            data = b.fetch_json(url)
            replies = (data.get("data") or {}).get("replies") or []
        except Exception as e:
            print(f"  [warn] {bvid} 获取失败: {e}")
            time.sleep(0.5)
            continue

        hot = []
        for r in replies:
            try:
                like = r.get("like", 0)
                if like < min_like:
                    continue
                hot.append({
                    "like": like,
                    "uname": r.get("member", {}).get("uname", "匿名"),
                    "level": r.get("member", {}).get("level_info", {}).get("current_level", "?"),
                    "content": r.get("content", {}).get("message", "").replace("\n", " "),
                    "loc": (r.get("reply_control", {}).get("location", "") or "").replace("IP属地：", ""),
                })
            except Exception:
                continue
        hot = hot[:top_per_video]

        if hot:
            got += 1
            md.append(f"\n---\n")
            md.append(f"## {idx}. {title[:40]}")
            md.append(f"`{bvid}` ｜ 评论数 {v.get('comment', 0)} ｜ 播放 {v.get('play', 0)}")
            for c in hot:
                md.append(
                    f"- 👍**{c['like']}** `{c['uname']}`(lv{c['level']}·{c['loc']}): {c['content'][:60]}"
                )
                csv_rows.append([idx, bvid, title, c["uname"], c["level"], c["like"], c["content"], c["loc"]])
        else:
            md.append(f"\n- {title[:40]} — `{bvid}`（无 ≥{min_like} 赞评论）")
        if idx % 50 == 0:
            print(f"  已浏览 {idx}/{len(vlist)}...")
        time.sleep(0.3)  # 限速

    safe_name = re.sub(r'[\\/:*?"<>|\n\r]', "_", uname)
    md_path = os.path.join(EXPORT_DIR, f"{safe_name}_高赞评论速览.md")
    with open(md_path, "w", encoding="utf-8") as f:
        f.write("\n".join(md))

    csv_path = os.path.join(EXPORT_DIR, f"{safe_name}_高赞评论速览.csv")
    with open(csv_path, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f)
        w.writerow(["视频序号", "BV号", "视频标题", "用户名", "等级", "点赞", "评论内容", "IP属地"])
        w.writerows(csv_rows)

    print(f"\n速览完成：{len(vlist)} 个视频中 {got} 个有高赞评论")
    print(f"Markdown: {md_path}")
    print(f"CSV: {csv_path}")
    return md_path


def export_comments(vlist, start, end):
    """批量导出评论，支持断点续跑（检测文件是否存在）"""
    if start < 1:
        start = 1
    if end > len(vlist):
        end = len(vlist)
    print(f"\n===== 批量导出评论: 第 {start}~{end} 个视频（共 {end - start + 1} 个） =====")
    # 子目录按 UP 主名
    safe_name = re.sub(r'[\\/:*?"<>|\n\r]', "_", uname)
    sub_dir = os.path.join(EXPORT_DIR, safe_name)
    os.makedirs(sub_dir, exist_ok=True)

    done, skipped = 0, 0
    for idx in range(start, end + 1):
        v = vlist[idx - 1]
        bvid, title = v["bvid"], v["title"]
        # 断点续跑检测：按 BV 号扫描子目录（标题可能因来源不同有细微差异，不能靠标题匹配）
        existing = [f for f in os.listdir(sub_dir) if f.endswith(".csv") and bvid in f]
        if existing:
            print(f"[skip] {idx}/{end} 已存在，跳过: {bvid} {title[:25]}")
            skipped += 1
            continue
        print(f"\n[{idx}/{end}] 开始导出: {bvid} {title[:30]}")
        try:
            b._mixin_key = b._mixin_key or b.get_mixin_key()
            out_path = b.crawl_video(bvid, True)  # 导出到 exports/ 根目录
            # 移动到 UP 主子目录
            if out_path and os.path.exists(out_path):
                new_path = os.path.join(sub_dir, os.path.basename(out_path))
                os.replace(out_path, new_path)
                # 精华报告也移动（如果生成在同目录）
                hl = os.path.splitext(out_path)[0] + "_精华.md"
                if os.path.exists(hl):
                    os.replace(hl, os.path.join(sub_dir, os.path.basename(hl)))
            done += 1
        except KeyboardInterrupt:
            print("\n[中断] 已手动停止。重新运行同命令可断点续跑。")
            break
        except Exception as e:
            print(f"[error] {bvid} 导出失败: {e}，继续下一个")
            continue
    print(f"\n批量导出结束: 完成 {done}，跳过 {skipped}（重复）")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="B站UP主视频列表+批量评论导出")
    parser.add_argument("name", help="UP 主名字")
    parser.add_argument("--order", default="like", choices=["like", "pubdate", "click"],
                        help="排序: like=点赞(默认) pubdate=发布时间 click=播放量")
    parser.add_argument("--export", action="store_true", help="批量导出每个视频的评论")
    parser.add_argument("--preview", action="store_true", help="快速浏览每个视频的高赞评论（省时）")
    parser.add_argument("--preview-top", type=int, default=3, help="每个视频预览的高赞评论条数（默认3）")
    parser.add_argument("--preview-min-like", type=int, default=5, help="高赞评论点赞门槛（默认5）")
    parser.add_argument("--preview-limit", type=int, default=0, help="只预览前N个视频（0=全部）")
    parser.add_argument("--start", type=int, default=1, help="批量导出的起始序号（默认1）")
    parser.add_argument("--end", type=int, default=0, help="批量导出的结束序号（默认全部）")
    args = parser.parse_args()

    b._mixin_key = b.get_mixin_key()
    print(f"wbi 密钥: {b._mixin_key[:8]}...")

    print(f"\n正在搜索 UP 主: {args.name}")
    found = search_uid(args.name)
    if not found:
        print(f"[error] 未找到 UP 主「{args.name}」，请检查名字或换更精确的关键词")
        sys.exit(1)
    mid, uname, fans = found
    print(f"找到: {uname} | UID: {mid} | 粉丝: {fans:,}")

    print(f"\n正在拉取视频列表（按{args.order}排序）...")
    vlist, total = fetch_all_videos(mid, order=args.order)
    if not vlist:
        print("[error] 未获取到视频，可能该UP主没有投稿或接口受限")
        sys.exit(1)
    print(f"共获取 {len(vlist)} / {total} 个视频")
    save_video_list(vlist, uname, args.order)

    if args.export:
        end = args.end if args.end > 0 else len(vlist)
        export_comments(vlist, args.start, end)
    elif args.preview:
        preview_highlights(vlist, top_per_video=args.preview_top,
                           min_like=args.preview_min_like, limit=args.preview_limit)
    else:
        print("\n如需快速浏览高赞评论，加 --preview；批量导出评论，加 --export。")
