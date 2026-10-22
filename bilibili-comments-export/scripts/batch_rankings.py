# -*- coding: utf-8 -*-
"""
批量跑多个视频的四榜分析：导出评论(断点续跑) → 生成四榜报告 → 汇总索引
用法: python batch_rankings.py BV1xxx BV2xxx ...
"""
import os
import re
import sys
import time
import glob
import subprocess

import bili_comments_export as b

BASE = os.path.dirname(os.path.abspath(__file__))
EXPORT_DIR = os.path.join(BASE, "exports")
# 允许通过环境变量覆盖输出目录（用于把产物放到工作区可见文件夹）
EXPORT_DIR = os.environ.get("BILI_OUTDIR", EXPORT_DIR)


def run(cmd):
    subprocess.run(cmd, shell=True, check=False, cwd=BASE)


def main():
    bvs = [a for a in sys.argv[1:] if a.strip()]
    if not bvs:
        print("用法: python batch_rankings.py BV1xxx BV2xxx ...")
        sys.exit(1)

    b._mixin_key = b.get_mixin_key()
    print(f"wbi 密钥: {b._mixin_key[:8]}...")
    print(f"待处理 {len(bvs)} 个视频")

    done_csv, done_rank, skipped, failed = [], [], 0, []

    for i, bv in enumerate(bvs, 1):
        print(f"\n{'='*50}\n[{i}/{len(bvs)}] {bv}")
        try:
            # 1. 导出评论（已存在则跳过）
            out_path = b.crawl_video(bv, True)
            if not out_path:
                # 可能已存在同名文件，查找
                existing = glob.glob(os.path.join(EXPORT_DIR, f"*{bv}.csv"))
                if existing:
                    out_path = existing[0]
                    skipped += 1
                    print(f"[skip] {bv} 评论已存在，跳过导出")
                else:
                    failed.append(bv)
                    continue
            done_csv.append(out_path)

            # 2. 跑四榜
            rank_cmd = (f"{os.path.join(BASE, '.venv', 'bin', 'python')} "
                        f"bili_rankings.py \"{out_path}\" --top 5")
            run(rank_cmd)
            rank_path = os.path.splitext(out_path)[0] + "_四榜.md"
            if os.path.exists(rank_path):
                done_rank.append(rank_path)
        except KeyboardInterrupt:
            print("\n[中断] 已停止，重跑可续")
            break
        except Exception as e:
            print(f"[error] {bv} 失败: {e}")
            failed.append(bv)
            continue
        time.sleep(0.5)

    # 3. 汇总索引
    if done_rank:
        idx = os.path.join(EXPORT_DIR, "_四榜汇总索引.md")
        with open(idx, "w", encoding="utf-8") as f:
            f.write("# 四榜报告汇总索引\n\n")
            for p in done_rank:
                name = os.path.basename(p).replace("_四榜.md", "")
                f.write(f"- [{name[:50]}]({os.path.relpath(p, EXPORT_DIR)})\n")
        print(f"\n汇总索引: {idx}")

    print(f"\n完成：成功 {len(done_rank)}，跳过导出 {skipped}，失败 {len(failed)}")
    if failed:
        print("失败列表:", failed)


if __name__ == "__main__":
    main()
