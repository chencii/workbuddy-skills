#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
build.py — 一条命令：一批「课时文本」→ 单文件 HTML 习题课件

    python3 build.py --src <目录或文件> --title "函数-指数、对数运算" [--out xx.html]

输入目录里**一个文件 = 一节课**，文件名推荐 `序号_课时名.md`（如 `01_指数的基本运算.md`）。
若文件名不是这个格式，用 --manifest 指定每节课的序号与名称（见 references/schema.md）。

流程：逐文件解析题目/答案 → 合成 deck.json → 调 render_deck.js 生成 HTML。
中间产物 deck.json 会写到输出文件旁边，方便手改后再单独跑 render_deck.js。
"""
import argparse, glob, json, os, re, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from parse_questions import parse_text          # noqa: E402

SKIP_STEM = {'manifest', 'names', 'readme', 'deck'}

# 可用的小插件；RETIRED 里的仍能被识别但会提示「已停用」，
# 这样老命令不会静默失效，用户能立刻看到原因。
WIDGETS = ('plant', 'plant-tl', 'pace', 'focus', 'roll', 'exit', 'allans')
RETIRED = {'nudge': '活动提醒', 'vote': '举手统计'}

def pick_widgets(spec):
    """把 --widgets 的逗号串过滤成有效插件列表，并对停用/未知项给出提示。"""
    out, notes = [], []
    for w in (spec or '').split(','):
        w = w.strip()
        if not w:
            continue
        if w in WIDGETS:
            out.append(w)
        elif w in RETIRED:
            notes.append('插件 %s（%s）已停用，已忽略' % (w, RETIRED[w]))
        else:
            notes.append('未知插件 %s，已忽略（可用：%s）' % (w, ' '.join(WIDGETS)))
    for n in notes:
        print('提示：' + n)
    return out

def natural_key(s):
    return [int(t) if t.isdigit() else t.lower() for t in re.split(r'(\d+)', s)]

def load_manifest(p):
    """支持两种写法：[{md/file/path, lesson_no/no, lesson_title/name/title}] 或 {文件名: {no,name}}"""
    raw = json.load(open(p, encoding='utf-8'))
    out = {}
    if isinstance(raw, dict):
        for k, v in raw.items():
            if isinstance(v, dict):
                out[os.path.basename(k)] = {'no': str(v.get('no', v.get('lesson_no', ''))),
                                            'name': v.get('name') or v.get('lesson_title') or ''}
    else:
        for it in raw:
            info = {
                'no': str(it.get('lesson_no', it.get('no', ''))),
                'name': it.get('lesson_title') or it.get('name') or it.get('title') or '',
            }
            # 源文件字段可能是 md / file / path / src，全都登记（避免误取到产物文件名）
            for k in ('md', 'file', 'path', 'src'):
                f = it.get(k)
                if f:
                    out.setdefault(os.path.basename(f), info)
    return out

def collect(src, manifest, chapter=None):
    """返回 [(排序键, 文件名, 课时号, 课时名)]"""
    files = []
    if os.path.isdir(src):
        for ext in ('*.md', '*.markdown', '*.txt'):
            files += glob.glob(os.path.join(src, ext))
    else:
        files.append(src)
    files = [f for f in sorted(files, key=natural_key)
             if os.path.splitext(os.path.basename(f))[0].lower() not in SKIP_STEM]
    if not files:
        raise SystemExit('没找到输入文件：' + src)

    items = []
    for i, f in enumerate(files):
        base = os.path.basename(f)
        stem = os.path.splitext(base)[0]
        info = manifest.get(base, {})
        no, name = info.get('no', ''), info.get('name', '')
        if not no or not name:
            m = re.match(r'^(\d+(?:\.\d+)?)\s*[_\-\.．、]\s*(.+)$', stem)
            # 要求「名字部分」不能只是数字，否则 08-01 这种（章节-课时）会被误读成 序号8_名字01
            if m and not re.fullmatch(r'[\d\s\-_]+', m.group(2)):
                no = no or m.group(1).lstrip('0') or '1'
                name = name or m.group(2).strip()
            else:
                m2 = re.search(r'[-\s](\d+)$', stem)  # 08-01（ima 风格）
                if m2:
                    no = no or str(int(m2.group(1)))
                name = name or stem
        no = no or str(i + 1)
        items.append((float(no), f, str(no), name))
    items.sort(key=lambda t: (t[0], natural_key(t[1])))
    return items

def main():
    ap = argparse.ArgumentParser(add_help=True)
    ap.add_argument('--src', required=True, help='课时文本目录，或单个文件')
    ap.add_argument('--title', required=True, help='章节大标题，如 08_函数-指数、对数运算')
    ap.add_argument('--out', help='输出的 HTML 路径（默认按标题命名，放当前目录）')
    ap.add_argument('--manifest', help='课时清单 JSON（指定每节课的序号与名称）')
    ap.add_argument('--kicker', help='封面小字，默认「高一数学 · 课后习题」')
    ap.add_argument('--keep-all', action='store_true', help='保留【提升】【综合】等进阶题（默认丢弃）')
    ap.add_argument('--cut', help='自定义切分标记，逗号分隔，默认 提升,综合,拓展,挑战')
    ap.add_argument('--widgets', help='课堂小插件，逗号分隔：plant pace focus roll exit allans（nudge/vote 已停用）')
    ap.add_argument('--only-json', action='store_true', help='只产出 deck.json，不渲染 HTML')
    a = ap.parse_args()

    cuts = () if a.keep_all else tuple('【%s】' % x.strip() for x in (a.cut or '提升,综合,拓展,挑战').split(','))
    manifest = load_manifest(a.manifest) if a.manifest else {}
    items = collect(a.src, manifest)

    lessons, warns = [], []
    print('课时清单：')
    for _, f, no, name in items:
        text = open(f, encoding='utf-8').read()
        lesson = parse_text(text, no=no, name=name, cuts=cuts)
        n_q, n_a = len(lesson['questions']), sum(1 for q in lesson['questions'] if q.get('ans'))
        flag = '' if (n_a == n_q and n_q) else '   <-- 注意'
        print('  %-4s %-28s %2d 题 / %2d 解析%s' % (no, name[:28], n_q, n_a, flag))
        if not n_q:
            warns.append('%s 没解析出题目' % os.path.basename(f))
        elif n_a < n_q:
            warns.append('%s 有 %d 题缺解析' % (os.path.basename(f), n_q - n_a))
        lessons.append(lesson)

    deck = {'title': a.title, 'chapter': re.match(r'^(\d+)', a.title).group(1) if re.match(r'^\d+', a.title) else '',
            'widgets': pick_widgets(a.widgets),
            'lessons': lessons}
    if a.kicker:
        deck['kicker'] = a.kicker

    pretty = re.sub(r'^\d+\s*[_\-\.．]?\s*', '', a.title)
    out_html = os.path.abspath(a.out or (pretty + '.html'))
    out_json = os.path.splitext(out_html)[0] + '.deck.json'
    os.makedirs(os.path.dirname(out_html), exist_ok=True)
    json.dump(deck, open(out_json, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('\n中间产物 -> %s' % out_json)

    if warns:
        print('\n注意：')
        for w in warns:
            print('  - ' + w)

    if a.only_json:
        return
    r = subprocess.run(['node', os.path.join(HERE, 'render_deck.js'), out_json, out_html])
    if r.returncode != 0:
        sys.exit(r.returncode)

if __name__ == '__main__':
    main()
