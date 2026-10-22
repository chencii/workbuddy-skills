"""用图片的像素聚类结构，判定哪一版课表 Excel 与 295.png 一致"""
import openpyxl, glob, os
import numpy as np
from PIL import Image
from collections import defaultdict
import re

SRC = '/Users/cc/.workbuddy/clipboard-images/clipboard-2026-10-06T10-13-41-502Z-d1e72cf3.jpg'
im = Image.open(SRC).convert('L').rotate(270, expand=True)
a = np.asarray(im).astype(float)
cols = [5,26,68,110,152,194,236,278,320,362,404,446,488,530,572,614,656,698,740,782,803]
blocks = [[0,25,51,77,103,129,155,181,207,233,259,285,311],
          [345,371,397,423,449,475,501,527,553,579,605,631,657,683],
          [717,743,769,795,821,847,873,899,925,951,977,1003,1029,1055],
          [1089,1115,1141,1167,1193,1219,1245,1271,1297,1323,1349,1375,1401,1427],
          [1461,1487,1513,1539,1565,1591,1617,1643,1669,1695,1721,1747,1773,1799]]

def rows(bi):
    rs = blocks[bi]
    idx = range(1, 12) if bi == 0 else range(2, 13)
    return [(rs[i], rs[i+1]) for i in idx]

classes = [f'{i:04d}' for i in range(2618, 2600, -1)]
obs = {}          # (cls, day, per) -> ink mask
for ci in range(1, 19):
    for bi in range(5):
        for ri, (y0, y1) in enumerate(rows(bi)):
            obs[(classes[ci-1], bi+1, ri+1)] = (a[y0+2:y1-2, cols[ci]+2:cols[ci+1]-2] < 160)

def obs_clusters(cls):
    keys = [k for k in obs if k[0] == cls]
    keys.sort(key=lambda k: (k[1], k[2]))
    par = list(range(len(keys)))
    def find(x):
        while par[x] != x:
            par[x] = par[par[x]]; x = par[x]
        return x
    for i in range(len(keys)):
        for j in range(i+1, len(keys)):
            if find(i) == find(j):
                continue
            if (obs[keys[i]] != obs[keys[j]]).mean() < 0.08:
                par[find(i)] = find(j)
    return keys, [find(i) for i in range(len(keys))]

OBS = {c: obs_clusters(c) for c in classes}

def parse_sheet1(path):
    wb = openpyxl.load_workbook(path, data_only=True)
    ws = wb.worksheets[0]
    grid = [[ws.cell(r, c).value for c in range(1, ws.max_column+1)] for r in range(1, ws.max_row+1)]
    # 找出每个日块的起始列（表头行里出现 '班级'）
    hdr = None
    for r in range(len(grid)):
        if grid[r][0] == '班级':
            hdr = r; break
    starts = [c for c, v in enumerate(grid[hdr]) if v == '班级']
    content = {}
    for si, c0 in enumerate(starts):
        for r in range(hdr+1, len(grid)):
            cls = grid[r][c0]
            if not cls or not re.fullmatch(r'26\d\d', str(cls)):
                continue
            for slot in range(12):
                v = grid[r][c0+1+slot]
                content[(str(cls), si+1, slot+1)] = (str(v).replace('\n', ' / ') if v else '')
    return content

def compare(content):
    tot = 0.0; n = 0
    for cls in classes:
        keys, lab = OBS[cls]
        m = len(keys)
        for i in range(m):
            for j in range(i+1, m):
                ci = content.get(keys[i], ''); cj = content.get(keys[j], '')
                if ci == '' and cj == '':
                    continue
                agree = (ci == cj) == (lab[i] == lab[j])
                tot += 1 if agree else 0
                n += 1
    return tot/n if n else 0, n

cands = sorted(glob.glob('/Users/cc/Desktop/*课表*.xlsx') + glob.glob('/Users/cc/Desktop/最新版.xlsx'), key=os.path.getmtime)
res = []
for p in cands:
    try:
        c = parse_sheet1(p)
        if not c:
            continue
        score, n = compare(c)
        res.append((score, os.path.basename(p), n))
    except Exception as e:
        print('skip', os.path.basename(p), e)
for s, name, n in sorted(res, reverse=True):
    print(f'{s*100:6.2f}%  对{p}  {name}')
