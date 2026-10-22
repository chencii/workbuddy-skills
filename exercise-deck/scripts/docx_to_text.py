#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
docx_to_text.py — 把 Word（.docx）转成「题目+答案」纯文本，供 parse_questions.py 使用

用法：
    python3 docx_to_text.py 题目.docx -o 课时1.md
    python3 docx_to_text.py 题目.docx            # 直接打印到屏幕
    python3 docx_to_text.py 题目.docx --report   # 额外列出没能转换的公式

做了什么：
  - 段落、表格（按行输出，制表符分隔）逐条取出
  - Word 公式（OMML）转成 LaTeX：$...$ 行内、$$...$$ 独立成行
    支持 分数、上下标、根式、括号、求和/积分等大运算符、极限、上划线/上括号、矩阵
  - 其余没覆盖的公式结构不会丢字：退化成它能取到的文本，并在 --report 里列出行号

注意：Word 里「图片化的公式」转不出来，需要先 OCR（可用 glmocr-formula 技能）
      或直接在 Word 里选中公式 → 复制 → 粘贴为「LaTeX」再贴回文档。
"""
import argparse, re, sys

M = '{http://schemas.openxmlformats.org/officeDocument/2006/math}'
W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'

UNSUPPORTED = []

def tag(el):
    return el.tag if isinstance(el.tag, str) else ''

def m(el, name):
    return el.find(M + name)

def kids(el, name):
    return el.findall(M + name)

def txt(el):
    """取节点下所有 m:t / w:t 文本"""
    out = []
    for t in el.iter():
        if tag(t) in (M + 't', W + 't') and t.text:
            out.append(t.text)
    return ''.join(out)

# ---------- OMML → LaTeX ----------
def omml(el, parent=None):
    t = tag(el)
    if t == M + 'oMath' or t == M + 'oMathPara':
        return ''.join(omml(c) for c in el)
    if t == M + 'r':                       # 普通 run
        return ''.join(c.text or '' for c in el if tag(c) in (M + 't', W + 't'))
    if t == M + 'f':                       # 分数
        num = ''.join(omml(c) for c in kids(el, 'num'))
        den = ''.join(omml(c) for c in kids(el, 'den'))
        return '\\frac{%s}{%s}' % (num, den)
    if t == M + 'sSup':
        e = ''.join(omml(c) for c in kids(el, 'e'))
        sup = ''.join(omml(c) for c in kids(el, 'sup'))
        return '{%s}^{%s}' % (e, sup)
    if t == M + 'sSub':
        e = ''.join(omml(c) for c in kids(el, 'e'))
        sub = ''.join(omml(c) for c in kids(el, 'sub'))
        return '{%s}_{%s}' % (e, sub)
    if t == M + 'sSubSup':
        e = ''.join(omml(c) for c in kids(el, 'e'))
        sub = ''.join(omml(c) for c in kids(el, 'sub'))
        sup = ''.join(omml(c) for c in kids(el, 'sup'))
        return '{%s}_{%s}^{%s}' % (e, sub, sup)
    if t == M + 'rad':                     # 根式
        deg = ''.join(omml(c) for c in kids(el, 'deg'))
        e = ''.join(omml(c) for c in kids(el, 'e'))
        return ('\\sqrt[%s]{%s}' % (deg, e)) if deg else ('\\sqrt{%s}' % e)
    if t == M + 'd':                       # 括号
        pr = m(el, 'dPr')
        ch = None
        if pr is not None:
            c = pr.find(M + 'begChr')
            e2 = pr.find(M + 'endChr')
            if c is not None: ch = (c.get(M + 'val'), e2.get(M + 'val') if e2 is not None else ')')
        beg, end = ch if ch else ('(', ')')
        inner = ''.join(omml(c) for c in kids(el, 'e'))
        return '\\left%s %s \\right%s' % (beg, inner, end) if beg else inner
    if t == M + 'nary':                    # 求和/积分等
        pr = m(el, 'naryPr')
        chr_ = '\\sum'
        sub = sup = ''
        if pr is not None:
            c = pr.find(M + 'chr')
            if c is not None:
                chr_ = {'∑': '\\sum', '∏': '\\prod', '∫': '\\int', '∮': '\\oint'}.get(c.get(M + 'val'), '\\sum')
        sub = ''.join(omml(c) for c in kids(el, 'sub'))
        sup = ''.join(omml(c) for c in kids(el, 'sup'))
        e = ''.join(omml(c) for c in kids(el, 'e'))
        return '%s_{%s}^{%s} %s' % (chr_, sub, sup, e)
    if t == M + 'func':
        name = txt(m(el, 'fName')) if m(el, 'fName') is not None else ''
        e = ''.join(omml(c) for c in kids(el, 'e'))
        name = name.strip()
        return ('\\%s' % name if name in ('sin', 'cos', 'tan', 'log', 'ln', 'exp', 'lg') else name) + e
    if t == M + 'limLow' or t == M + 'limUpp':
        e = ''.join(omml(c) for c in kids(el, 'e'))
        lim = ''.join(omml(c) for c in kids(el, 'lim'))
        return ('%s_{%s}' % (e, lim)) if t == M + 'limLow' else ('%s^{%s}' % (e, lim))
    if t == M + 'bar':
        e = ''.join(omml(c) for c in kids(el, 'e'))
        return '\\overline{%s}' % e
    if t == M + 'acc':                     # 带重音
        e = ''.join(omml(c) for c in kids(el, 'e'))
        ch = ''
        pr = m(el, 'accPr')
        if pr is not None:
            c = pr.find(M + 'chr')
            if c is not None: ch = c.get(M + 'val') or ''
        sym = {'̂': '\\hat', '̄': '\\bar', '⃗': '\\vec', '̇': '\\dot'}.get(ch, '\\hat')
        return '%s{%s}' % (sym, e)
    if t == M + 'groupChr':                # 上/下花括号
        pr = m(el, 'groupChrPr')
        ch = ''
        if pr is not None:
            c = pr.find(M + 'chr')
            if c is not None: ch = c.get(M + 'val') or ''
        e = ''.join(omml(c) for c in kids(el, 'e'))
        return ('\\underbrace{%s}' % e) if ch == '⏟' else ('\\overbrace{%s}' % e)
    if t == M + 'm':                       # 矩阵
        rows = []
        for mr in el.findall(M + 'mr'):
            rows.append(' & '.join(''.join(omml(c) for c in kids(cell, 'e')) for cell in mr.findall(M + 'e')))
        return '\\begin{pmatrix}%s\\end{pmatrix}' % ' \\\\ '.join(rows)
    if t in (M + 'dPr', M + 'fPr', M + 'radPr', M + 'naryPr', M + 'funcPr', M + 'limLowPr',
             M + 'limUppPr', M + 'accPr', M + 'groupChrPr', M + 'sSupPr', M + 'sSubPr',
             M + 'sSubSupPr', M + 'mPr', M + 'ctrlPr', M + 'rPr', M + 'argPr'):
        return ''
    # 兜底：递归拼接，绝不丢字
    inner = ''.join(omml(c) for c in el)
    if inner:
        if t not in (M + 'e', M + 'num', M + 'den', M + 'sup', M + 'sub', M + 'deg'):
            UNSUPPORTED.append(t.replace(M, 'm:'))
        return inner
    return txt(el)

def para_to_text(p):
    """一个 <w:p> → 文本行（公式转 $...$ / $$...$$）"""
    parts = []
    for child in p:
        tg = tag(child)
        if tg == W + 'r':
            s = ''.join(t.text or '' for t in child if tag(t) == W + 't')
            parts.append(s)
        elif tg == M + 'oMath':
            parts.append('$%s$' % omml(child))
        elif tg == M + 'oMathPara':
            parts.append('\n$$%s$$\n' % omml(child))
        elif tg == W + 'hyperlink':
            parts.append(''.join(t.text or '' for t in child.iter(W + 't')))
    line = ''.join(parts)
    return re.sub(r'[ \t]+', ' ', line).strip()

def table_to_lines(tbl):
    for row in tbl.findall(W + 'tr'):
        cells = []
        for tc in row.findall(W + 'tc'):
            ps = [para_to_text(p) for p in tc.findall(W + 'p')]
            cells.append(' '.join(x for x in ps if x))
        yield '\t'.join(cells)

def convert(path, report=False):
    try:
        from docx import Document
    except ImportError:
        sys.exit('需要 python-docx：pip install python-docx（清华镜像 -i https://pypi.tuna.tsinghua.edu.cn/simple）')
    doc = Document(path)
    body = doc.element.body
    lines = []
    for el in body:
        tg = tag(el)
        if tg == W + 'p':
            t = para_to_text(el)
            if t:
                lines.append(t)
        elif tg == W + 'tbl':
            lines.extend(table_to_lines(el))
    out = '\n'.join(lines)
    if report and UNSUPPORTED:
        from collections import Counter
        print('未完全支持的公式结构：', dict(Counter(UNSUPPORTED)), file=sys.stderr)
    return out

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('docx')
    ap.add_argument('-o', '--out')
    ap.add_argument('--report', action='store_true', help='列出没转换好的公式结构')
    a = ap.parse_args()
    text = convert(a.docx, a.report)
    if a.out:
        open(a.out, 'w', encoding='utf-8').write(text)
        n = sum(1 for l in text.split('\n') if re.match(r'^\d+\s*[.、．]', l))
        print('%s -> %s（%d 行，识别到 %d 个题号行）' % (a.docx, a.out, text.count('\n') + 1, n))
    else:
        print(text)

if __name__ == '__main__':
    main()
