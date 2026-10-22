"""从 295.png 课表截图重建课表格子：列内聚类 -> 跨班合并 -> 平均去噪 -> 导出待识别图"""
from PIL import Image
import numpy as np, json, os

SRC = '/Users/cc/.workbuddy/clipboard-images/clipboard-2026-10-06T10-13-41-502Z-d1e72cf3.jpg'
OUT = '/tmp/rebuild'
os.makedirs(OUT, exist_ok=True)

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
cells, meta = [], []
for ci in range(1, 19):
    for bi in range(5):
        for ri, (y0, y1) in enumerate(rows(bi)):
            cells.append(a[y0+2:y1-2, cols[ci]+2:cols[ci+1]-2])
            meta.append({'cls': classes[ci-1], 'col': ci, 'day': bi+1, 'per': ri+1})
cells = np.array(cells)
M = (cells < 160).astype(np.uint8)

def union_cluster(items, dist):
    par = list(range(len(items)))
    def find(x):
        while par[x] != x:
            par[x] = par[par[x]]; x = par[x]
        return x
    for i in range(len(items)):
        for j in range(i+1, len(items)):
            if find(i) == find(j):
                continue
            if dist(items[i], items[j]):
                par[find(i)] = find(j)
    from collections import defaultdict
    g = defaultdict(list)
    for i, it in enumerate(items):
        g[find(i)].append(it)
    return list(g.values())

byclass = {}
for k, m in enumerate(meta):
    byclass.setdefault(m['cls'], []).append(k)

reps, repmeta = [], []
for cls, idx in byclass.items():
    d = lambda i, j: (M[i] != M[j]).mean() < 0.08
    for grp in union_cluster(idx, d):
        reps.append(cells[grp].mean(0))
        repmeta.append({'cls': cls, 'n': len(grp), 'members': [meta[i] for i in grp]})
R = np.array(reps)
print('列内簇数', len(R))

flat = R.reshape(len(R), -1)
f = flat - flat.mean(1, keepdims=True)
X = f / (np.linalg.norm(f, axis=1, keepdims=True) + 1e-9)
S = X @ X.T
d = lambda i, j: S[i, j] > 0.93
G = union_cluster(list(range(len(R))), d)
print('跨班分组数', len(G))

grp = []
for members in sorted(G, key=lambda m: -len(m)):
    avg = R[members].mean(0)
    grp.append({'n': sum(repmeta[m]['n'] for m in members),
                'reps': len(members),
                'cls': sorted({repmeta[m]['cls'] for m in members}),
                'avg': avg,
                'members': [repmeta[m] for m in members]})

for i, g in enumerate(grp):
    img = Image.fromarray(np.clip(g['avg'], 0, 255).astype(np.uint8))
    img.resize((img.width*12, img.height*12), Image.Resampling.LANCZOS).save(f'{OUT}/g{i:03d}.png')
    img.crop((0, 0, img.width, 11)).resize((img.width*12, 132), Image.Resampling.LANCZOS).save(f'{OUT}/g{i:03d}-top.png')
    img.crop((0, 11, img.width, img.height)).resize((img.width*12, (img.height-11)*12), Image.Resampling.LANCZOS).save(f'{OUT}/g{i:03d}-bot.png')

json.dump([{k: v for k, v in g.items() if k != 'avg'} for g in grp],
          open(f'{OUT}/groups.json', 'w'), ensure_ascii=False, indent=1, default=str)
np.save(f'{OUT}/avg.npy', np.array([g['avg'] for g in grp]))
print('分组规模前30:', [(g['n'], g['reps'], len(g['cls'])) for g in grp[:30]])
