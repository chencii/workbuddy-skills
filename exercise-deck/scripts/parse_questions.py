#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
parse_questions.py — 把「一节课的题目+答案」文本（Markdown 或纯文本）转成结构化 JSON

设计目标：**与来源无关**。ima 导出的 Markdown、Word 转出的文本、手打的纯文本，
只要满足下面这套最朴素的书写习惯，就能被认出来：

    1. 题目正文（可以用 $...$ 写公式）
    （1）子问，或直接跟在题干后面
    $$ 独立成行的公式 $$
    A. 选项一        B. 选项二         ← 选择题选项
    ...
    （解析）                          ← 题目/答案的分界（也认「1. 试题解析」「答案：」）
    1. 第 1 题的解析
    （1）分步解析
    ...
    【提升】                          ← 此后的内容全部丢弃（只要基础题）

用法：
    python3 parse_questions.py <输入文件> [--no 1] [--name "课时名"]
                               [--flavor ima|plain] [--cut 提升,综合,拓展,挑战]
                               [--keep-all] [--out lesson.json]

也可作为模块导入：from parse_questions import parse_text
"""
import json, os, re, sys

# ---------- 清洗 ----------
JUNK_PAT = re.compile(r'(ABOUT\s*MATH|扫码|学习更多课程|学数®|高中数学/)')

def clean_text(t):
    t = t.replace('\u3000', ' ').replace('\xa0', ' ')
    t = re.sub(r'[ \t]+', ' ', t)
    return t.strip()

def is_junk(line):
    s = line.strip()
    if not s:
        return True
    if re.fullmatch(r'\d{1,3}', s):          # 页码
        return True
    if JUNK_PAT.search(s):
        return True
    if re.match(r'^!\[.*\]\(.*\)$', s):      # 图片
        return True
    if re.match(r'^-{3,}$', s) or re.match(r'^={3,}$', s):
        return True
    return False

def merge_math_lines(lines):
    """把跨多行的 $$ ... $$ 合并成一行"""
    out, buf, in_math = [], [], False
    for ln in lines:
        s = ln.strip()
        if in_math:
            buf.append(s)
            if s.endswith('$$'):
                out.append(' '.join(buf)); buf, in_math = [], False
            continue
        if s.startswith('$$') and not s.endswith('$$'):
            in_math = True; buf = [s]; continue
        out.append(s)
    if buf:
        out.append(' '.join(buf))
    return out

def clean_latex(x):
    x = x.strip()
    x = x.replace('\u3000', ' ').replace('\xa0', ' ')
    x = re.sub(r'\\quad|\\;|\\!|\\,|\\:', ' ', x)
    x = re.sub(r'\s+', ' ', x).strip()
    x = x.strip(';；,，')
    return x

def to_frags(s, display=False):
    """行内公式 $...$ 与文本交替 → [["t",文本],["m",latex], ...]"""
    s = s.strip()
    if not s:
        return []
    parts = re.split(r'\$([^$]+)\$', s)
    frags = []
    for i, p in enumerate(parts):
        if p == '':
            continue
        if i % 2 == 1:
            latex = clean_latex(p)
            if latex:
                frags.append(['m', latex])
        else:
            t = clean_text(p)
            if t:
                frags.append(['t', t])
    return frags

# ---------- 行类型 ----------
SUB_RE = re.compile(r'^[（(](\d{1,2})[）)]\s*(.*)$')
OPT_RE = re.compile(r'^([A-D])\s*[.、．]\s*(.*)$')
Q_RE   = re.compile(r'^(\d{1,2})\s*[.、．:：]\s*(.*)$')
ANS_RE = re.compile(r'^(\d{1,2})\s*[.、．]?\s*(试题解析|解答|解析|析)\s*[:：]?\s*$')
SPLIT_RE = re.compile(r'[（(]\s*(解析|答案|解答|试题解析)\s*[）)]')

def strip_dollar_wrapper(s):
    """$$B. xxx$$ → B. xxx"""
    s = s.strip()
    if s.startswith('$$') and s.endswith('$$') and len(s) > 4:
        return s[2:-2].strip()
    return s

GARBAGE_RE = re.compile(r'(?:^|\s)(?:\w|[\u4e00-\u9fff])(?:\s+(?:\w|[\u4e00-\u9fff])){2,}')

def is_garbage(s):
    """识别「字符被空格拆碎」的 OCR 垃圾行（例如 'x 2 y 3' 这种）"""
    if '$' in s:
        return False
    if re.search(r'[，。；：、！？]', s) and len(s) > 12:
        return False
    if GARBAGE_RE.search(s):
        return True
    if len(s) <= 6 and not re.search(r'[\u4e00-\u9fff]{2}', s):
        return True
    return False

# ---------- 主体解析 ----------
def parse_exercise(lines, cuts):
    qs, cur, opts_buf = [], None, None

    def flush_opts():
        nonlocal opts_buf
        if opts_buf and cur is not None:
            cur['blocks'].append({'type': 'opts', 'items': opts_buf})
        opts_buf = None

    def add_para(label, body, display=False):
        if display:   # 一行里塞了多个 (n) 子问 → 拆开
            parts = re.split(r'[;；]\s*(?:\\quad\s*)?[（(](\d{1,2})[）)]', body)
            if len(parts) > 1:
                first = parts[0].strip()
                if first:
                    cur['blocks'].append({'type': 'para', 'label': label, 'frags': [['m', clean_latex(first)]]})
                for k in range(1, len(parts), 2):
                    cur['blocks'].append({'type': 'para', 'label': '(%s)' % parts[k],
                                          'frags': [['m', clean_latex(parts[k + 1])]]})
                return
        frags = [['m', clean_latex(body)]] if display else to_frags(body)
        cur['blocks'].append({'type': 'para', 'label': label, 'frags': frags})

    for raw in lines:
        s = strip_dollar_wrapper(raw)
        if not s:
            continue
        if any(c in s for c in cuts):        # 【提升】之后一律不要
            break
        m = Q_RE.match(s)
        if m and (cur is None or int(m.group(1)) == cur['no'] + 1):
            flush_opts()
            cur = {'no': int(m.group(1)), 'blocks': []}
            qs.append(cur)
            rest = m.group(2).strip()
            if rest:
                add_para('%s.' % m.group(1), rest)
            continue
        if cur is None:
            continue
        m = SUB_RE.match(s)
        if m:
            flush_opts()
            add_para('(%s)' % m.group(1), m.group(2), raw.strip().startswith('$$'))
            continue
        m = OPT_RE.match(s)
        if m:
            if opts_buf is None:
                opts_buf = []
            opts_buf.append({'label': m.group(1), 'frags': to_frags(m.group(2))})
            continue
        if opts_buf is not None:
            flush_opts()
        if raw.strip().startswith('$$'):
            cur['blocks'].append({'type': 'para', 'label': '', 'display': True,
                                  'frags': [['m', clean_latex(s)]]})
        elif cur['blocks']:
            cur['blocks'][-1]['frags'].extend(to_frags(s))
        else:
            add_para('', s)
    flush_opts()
    return qs

def parse_answers(lines, cuts, max_no=99):
    """答案区解析。每题一段，段首用题号开头：
       显式「1. 试题解析」或隐式「1. 内容……」都认（后者要求题号递增且不超过题数）"""
    ans, cur_no, buf = {}, None, []

    def flush():
        nonlocal buf, cur_no
        if cur_no is None:
            return
        steps = []
        for s in buf:
            s2 = strip_dollar_wrapper(s)
            if not s2 or is_junk(s2):
                continue
            if any(c in s2 for c in cuts):
                break
            display = s.strip().startswith('$$')
            if not display and is_garbage(s2):
                continue
            m = SUB_RE.match(s2)
            label, body = ('(%s)' % m.group(1), m.group(2)) if m else ('', s2)
            frags = [['m', clean_latex(body)]] if display else to_frags(body)
            steps.append({'label': label, 'frags': frags, 'display': display})
        if steps:
            ans[cur_no] = steps
        buf = []

    for raw in lines:
        s = raw.strip()
        if not s:
            continue
        m = ANS_RE.match(s)                      # 显式：1. 试题解析
        if m:
            flush()
            cur_no = int(m.group(1))
            continue
        m2 = Q_RE.match(s)                       # 隐式：1. 由题意得……
        if m2:
            n = int(m2.group(1))
            if 1 <= n <= max_no and (cur_no is None or n > cur_no):
                flush()
                cur_no = n
                rest = m2.group(2).strip()
                if rest:
                    buf.append(rest)
                continue
        if cur_no is not None:
            buf.append(s)
    flush()
    return ans

def parse_text(text, no='1', name='', cuts=('【提升】', '【综合】', '【拓展】', '【挑战】')):
    """核心入口：文本 → {"no","name","questions":[...]}"""
    if '\n' not in text and '\\n' in text:
        text = text.replace('\\n', '\n')
    lines = [ln.rstrip() for ln in text.split('\n')]
    lines = [re.sub(r'^#+\s*', '', ln) for ln in lines]      # 去掉 markdown 井号标题
    lines = [ln for ln in lines if not is_junk(ln)]
    lines = merge_math_lines(lines)

    # 题目 / 答案 分界
    split_idx = None
    for i, ln in enumerate(lines):
        if SPLIT_RE.search(ln):
            split_idx = i
            break
    if split_idx is None:
        for i, ln in enumerate(lines):
            if ANS_RE.match(ln.strip()):
                split_idx = i
                break
    ex_lines = lines[:split_idx] if split_idx is not None else lines
    an_lines = lines[split_idx:] if split_idx is not None else []
    for i, ln in enumerate(an_lines):        # 答案区同样只要提升之前
        if any(c in ln for c in cuts):
            an_lines = an_lines[:i]
            break

    qs = parse_exercise(ex_lines, cuts)
    ans = parse_answers(an_lines, cuts, max([q['no'] for q in qs], default=0))

    questions = []
    for q in qs:
        item = {'blocks': q['blocks']}
        steps = ans.get(q['no'])
        if steps:
            item['ans'] = {'steps': steps}
        questions.append(item)
    return {'no': str(no), 'name': name, 'questions': questions}

def main():
    argv = sys.argv[1:]
    if not argv or argv[0] in ('-h', '--help'):
        print(__doc__)
        sys.exit(0 if argv else 1)
    src, opts = argv[0], {}
    i = 1
    while i < len(argv):
        a = argv[i]
        if a in ('--no', '--name', '--flavor', '--cut', '--out'):
            opts[a[2:]] = argv[i + 1]; i += 2
        elif a == '--keep-all':
            opts['keep_all'] = True; i += 1
        else:
            print('未知参数:', a); sys.exit(1)
    cuts = () if opts.get('keep_all') else tuple(
        ('【%s】' % x.strip()) for x in (opts.get('cut') or '提升,综合,拓展,挑战').split(','))
    text = sys.stdin.read() if src == '-' else open(src, encoding='utf-8').read()
    lesson = parse_text(text, no=opts.get('no', '1'), name=opts.get('name', ''), cuts=cuts)
    n_q = len(lesson['questions'])
    n_a = sum(1 for q in lesson['questions'] if q.get('ans'))
    out = opts.get('out')
    if out:
        json.dump(lesson, open(out, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
        print('%s: %d 题 / %d 个解析 -> %s' % (os.path.basename(src), n_q, n_a, out))
    else:
        print(json.dumps(lesson, ensure_ascii=False, indent=1))

if __name__ == '__main__':
    main()
