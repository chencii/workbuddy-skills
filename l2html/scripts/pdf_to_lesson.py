#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
pdf_to_lesson.py — PDF 试卷 → 课时文本（公式图按阅读顺序内联）

做法：读 PDF 的文字层（题目、选项、说明文字）+ 图片层（公式一般是位图），
按「先 y 后 x」的阅读顺序合并成 Markdown，公式位置留下 `![f001](imgs/f001.png)` 占位。

    python3 pdf_to_lesson.py 试卷.pdf [--out 课时.md] [--imgs imgs/]

然后：
  - 有公式 OCR（glmocr-formula / ZHIPU_API_KEY）时，把 imgs/ 里每张图转成 LaTeX 替换占位符；
  - 没有时，把 imgs/ 的图拼成"每题的公式条"人工/模型识读后填入。

题号识别：`12．` / `12.` 开头的行算新题；`（1）`/`(1)` 是子问；`A.` 是选项。
"""
import argparse, os, re, sys

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('pdf')
    ap.add_argument('--out', help='输出 markdown（默认打印到屏幕）')
    ap.add_argument('--imgs', help='公式图输出目录（默认 <输出名>.imgs/）')
    ap.add_argument('--pages', help='只处理这些页，如 1-4')
    ap.add_argument('--dpi', type=int, default=300, help='公式图渲染倍率')
    a = ap.parse_args()

    import fitz
    doc = fitz.open(a.pdf)
    out = a.out or (os.path.splitext(os.path.basename(a.pdf))[0] + '.md')
    imgdir = a.imgs or (os.path.splitext(out)[0] + '.imgs')
    if a.out or a.imgs:
        os.makedirs(imgdir, exist_ok=True)

    lines = []
    nimg = 0
    first, last = (1, len(doc))
    if a.pages:
        first, last = [int(x) for x in a.pages.split('-')]
    for pno in range(first - 1, last):
        page = doc[pno]
        lines.append('')
        lines.append('%% ==== 第 %d 页 ====' % (pno + 1))
        items = []          # (y, x, kind, payload)
        for b in page.get_text('dict')['blocks']:
            if b.get('type') == 0:
                for l in b['lines']:
                    txt = ''.join(s['text'] for s in l['spans']).strip()
                    if txt:
                        items.append((round(l['bbox'][1], 1), round(l['bbox'][0], 1), 't', txt))
        for it in page.get_image_info(xrefs=True):
            # 用图片垂直中心归行：图片比一行文字高时，按它的中线判断属于哪一行
            cy = (it['bbox'][1] + it['bbox'][3]) / 2
            items.append((round(cy, 1), round(it['bbox'][0], 1), 'i', it))
        items.sort(key=lambda t: (t[0], t[1]))

        # 同一行内的文字/图片按 x 拼接
        lasty = None
        def flush_row():
            if not buf:
                return
            parts = []
            for _, kind, val in buf:
                if kind == 't':
                    parts.append(val)
                else:
                    parts.append('![f](imgs/placeholder.png)')
            lines.append(''.join(parts))
        buf = []
        for y, x, kind, val in items:
            if lasty is not None and abs(y - lasty) > 3:
                flush_row(); buf = []
            if kind == 't':
                buf.append((x, kind, val))
            else:
                nimg += 1
                xref = val.get('xref')
                name = 'f%03d.png' % nimg
                if a.out or a.imgs:
                    # 优先直接取原图；取不到就按页面区域高分辨率渲染
                    try:
                        raw = doc.extract_image(xref)
                        open(os.path.join(imgdir, name), 'wb').write(raw['image'])
                    except Exception:
                        pix = page.get_pixmap(clip=fitz.Rect(val['bbox']), matrix=fitz.Matrix(4, 4))
                        pix.save(os.path.join(imgdir, name))
                buf.append((x, 'i', name))
            lasty = y
        flush_row()

    text = '\n'.join(lines)
    # 把占位符换成真实文件名
    if a.out or a.imgs:
        for i in range(1, nimg + 1):
            text = text.replace('![f](imgs/placeholder.png)', '![f%03d](imgs/f%03d.png)' % (i, i), 1)
    if a.out:
        open(a.out, 'w', encoding='utf-8').write(text)
        print('%s -> %s（%d 个公式图 -> %s）' % (a.pdf, a.out, nimg, imgdir))
    else:
        print(text)

main()
