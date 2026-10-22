/**
 * figs.js — 按学案原图重绘的示意图（内联 SVG，矢量）
 * 每张图都对应原稿 word/media 里的一张插图，刻度、关键点、虚线位置一致。
 */
const INK = '#1F3A5F';
const ACC = '#B8552F';
const GREY = '#9A948A';
const MUT = '#8A857C';

/* 平滑曲线：Catmull-Rom → 三次贝塞尔 */
function smooth(pts) {
  if (pts.length < 2) return '';
  let d = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += `C${c1x.toFixed(1)} ${c1y.toFixed(1)} ${c2x.toFixed(1)} ${c2y.toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  return d;
}

function box(o) {
  const w = o.w || 420, h = o.h || 300;
  const pad = o.pad || { l: 34, r: 26, t: 18, b: 30 };
  const [x0, x1] = o.xr, [y0, y1] = o.yr;
  const iw = w - pad.l - pad.r, ih = h - pad.t - pad.b;
  const X = x => pad.l + (x - x0) / (x1 - x0) * iw;
  const Y = y => pad.t + (y1 - y) / (y1 - y0) * ih;
  const uid = o.id || 'g';
  let s = `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" xmlns="http://www.w3.org/2000/svg">`;
  s += `<defs><marker id="a-${uid}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse">`
    + `<path d="M0 0 L10 5 L0 10 z" fill="${GREY}"/></marker></defs>`;
  return { s, X, Y, w, h, pad, uid, close: '</svg>' };
}

function axes(F) {
  const ax = F.Y(0), ay = F.X(0);
  return F.s
    + `<line x1="${F.pad.l - 8}" y1="${ax}" x2="${F.w - F.pad.r + 10}" y2="${ax}" stroke="${GREY}" stroke-width="1.3" marker-end="url(#a-${F.uid})"/>`
    + `<line x1="${ay}" y1="${F.h - F.pad.b + 8}" x2="${ay}" y2="${F.pad.t - 10}" stroke="${GREY}" stroke-width="1.3" marker-end="url(#a-${F.uid})"/>`;
}

function curvePts(F, fn, a, b, n) {
  n = n || 220;
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const x = a + (b - a) * i / n, y = fn(x);
    if (!isFinite(y)) continue;
    pts.push([F.X(x), F.Y(y)]);
  }
  return pts;
}

function txt(F, t, o) {
  o = o || {};
  const px = o.px != null ? o.px : F.X(0);
  const py = o.py != null ? o.py : F.Y(0);
  return `<text x="${px}" y="${py}" font-size="${o.fs || 13}" fill="${o.color || INK}" text-anchor="${o.anchor || 'middle'}" font-family="PingFang SC,sans-serif"${o.style ? ` font-style="${o.style}"` : ''}>${t}</text>`;
}

function dashV(F, x, yTop, yBot) {
  return `<line x1="${F.X(x)}" y1="${F.Y(yTop)}" x2="${F.X(x)}" y2="${F.Y(yBot)}" stroke="${ACC}" stroke-width="1.1" stroke-dasharray="5 4" opacity=".75"/>`;
}
function pt(F, x, y, r) {
  return `<circle cx="${F.X(x)}" cy="${F.Y(y)}" r="${r || 3.2}" fill="#fff" stroke="${INK}" stroke-width="1.5"/>`;
}

/* 1. 增函数图示（原图 image2） */
function incr() {
  const F = box({ id: 'i1', w: 400, h: 290, xr: [0, 3.0], yr: [0, 4.4], pad: { l: 48, r: 34, t: 22, b: 36 } });
  const fn = x => 1.05 + 1.55 * (x - 1) + 0.32 * (x - 1) * (x - 1);
  let s = axes(F);
  s += `<path d="${smooth(curvePts(F, fn, 1.0, 2.52, 40))}" fill="none" stroke="${INK}" stroke-width="2.4" stroke-linecap="round"/>`;
  s += dashV(F, 1.0, fn(1.0), 0) + dashV(F, 2.0, fn(2.0), 0);
  s += pt(F, 1.0, fn(1.0)) + pt(F, 2.0, fn(2.0));
  s += txt(F, 'O', { px: F.X(0) + 8, py: F.Y(0) - 8, fs: 14, style: 'italic', anchor: 'start' });
  s += txt(F, 'x₁', { px: F.X(1.0), py: F.Y(0) + 20, fs: 14 });
  s += txt(F, 'x₂', { px: F.X(2.0), py: F.Y(0) + 20, fs: 14 });
  s += txt(F, 'f(x₁)', { px: F.X(1.0) + 10, py: F.Y(fn(1.0)) + 26, fs: 12.5, anchor: 'start' });
  s += txt(F, 'f(x₂)', { px: F.X(2.0) + 10, py: F.Y(fn(2.0)) + 26, fs: 12.5, anchor: 'start' });
  s += txt(F, 'y=f(x)', { px: F.X(2.18), py: F.Y(3.58), fs: 13, anchor: 'end' });
  s += txt(F, 'y', { px: F.X(0) - 7, py: F.pad.t - 10, fs: 13, style: 'italic' });
  s += txt(F, 'x', { px: F.w - F.pad.r + 8, py: F.Y(0) - 9, fs: 13, style: 'italic' });
  return s + F.close;
}

/* 2. 减函数图示（原图 image3） */
function decr() {
  const F = box({ id: 'i2', w: 400, h: 290, xr: [0, 3.0], yr: [0, 4.4], pad: { l: 48, r: 34, t: 22, b: 36 } });
  const fn = x => 4.05 - 1.55 * (x - 1) - 0.32 * (x - 1) * (x - 1);
  let s = axes(F);
  s += `<path d="${smooth(curvePts(F, fn, 1.0, 2.52, 40))}" fill="none" stroke="${INK}" stroke-width="2.4" stroke-linecap="round"/>`;
  s += dashV(F, 1.0, fn(1.0), 0) + dashV(F, 2.0, fn(2.0), 0);
  s += pt(F, 1.0, fn(1.0)) + pt(F, 2.0, fn(2.0));
  s += txt(F, 'O', { px: F.X(0) + 8, py: F.Y(0) - 8, fs: 14, style: 'italic', anchor: 'start' });
  s += txt(F, 'x₁', { px: F.X(1.0), py: F.Y(0) + 20, fs: 14 });
  s += txt(F, 'x₂', { px: F.X(2.0), py: F.Y(0) + 20, fs: 14 });
  s += txt(F, 'f(x₁)', { px: F.X(1.0) - 10, py: F.Y(fn(1.0)) + 30, fs: 12.5, anchor: 'end' });
  s += txt(F, 'f(x₂)', { px: F.X(2.0) - 10, py: F.Y(fn(2.0)) + 26, fs: 12.5, anchor: 'end' });
  s += txt(F, 'y=f(x)', { px: F.X(1.42), py: F.Y(3.62), fs: 13, anchor: 'start' });
  s += txt(F, 'y', { px: F.X(0) - 7, py: F.pad.t - 10, fs: 13, style: 'italic' });
  s += txt(F, 'x', { px: F.w - F.pad.r + 8, py: F.Y(0) - 9, fs: 13, style: 'italic' });
  return s + F.close;
}

/* 3. 思考1 反例图（原图 image7） */
function counter() {
  const F = box({ id: 'i3', w: 360, h: 300, xr: [-2.0, 2.9], yr: [-1.4, 3.4], pad: { l: 42, r: 30, t: 20, b: 34 } });
  const fn = x => 0.95 * (x - 0.45) * (x - 0.45) - 1.15;
  let s = axes(F);
  s += `<path d="${smooth(curvePts(F, fn, -1.72, 2.55, 80))}" fill="none" stroke="${INK}" stroke-width="2.4" stroke-linecap="round"/>`;
  s += dashV(F, -1, fn(-1), 0) + dashV(F, 2, fn(2), 0);
  s += pt(F, -1, fn(-1)) + pt(F, 2, fn(2));
  s += txt(F, 'O', { px: F.X(0) + 7, py: F.Y(0) - 9, fs: 14, style: 'italic', anchor: 'start' });
  s += txt(F, '−1', { px: F.X(-1), py: F.Y(0) + 20, fs: 14 });
  s += txt(F, '2', { px: F.X(2), py: F.Y(0) + 20, fs: 14 });
  s += txt(F, 'y', { px: F.X(0) - 10, py: F.pad.t - 6, fs: 13, style: 'italic' });
  s += txt(F, 'x', { px: F.w - F.pad.r + 6, py: F.Y(0) - 8, fs: 13, style: 'italic' });
  return s + F.close;
}

/* 4. 例2(3) 图（原图 image8） */
function absq() {
  const F = box({ id: 'i4', w: 380, h: 320, xr: [-3.55, 3.55], yr: [-0.9, 4.9], pad: { l: 40, r: 28, t: 20, b: 34 } });
  const fn = x => -x * x + 2 * Math.abs(x) + 3;
  let s = axes(F);
  s += `<path d="${smooth(curvePts(F, fn, -3.05, 3.05, 220))}" fill="none" stroke="${INK}" stroke-width="2.4" stroke-linecap="round"/>`;
  s += dashV(F, -1, 4, 0) + dashV(F, 1, 4, 0);
  s += pt(F, -1, 4) + pt(F, 1, 4);
  s += txt(F, 'O', { px: F.X(0) + 7, py: F.Y(0) - 8, fs: 13, style: 'italic', anchor: 'start' });
  s += txt(F, '3', { px: F.X(0) + 12, py: F.Y(3) - 6, fs: 13, anchor: 'start' });
  [[-3, '−3'], [-1, '−1'], [1, '1'], [3, '3']].forEach(([v, lab]) => {
    s += `<line x1="${F.X(v)}" y1="${F.Y(0) - 3}" x2="${F.X(v)}" y2="${F.Y(0) + 3}" stroke="${GREY}" stroke-width="1"/>`;
    s += txt(F, lab, { px: F.X(v), py: F.Y(0) + 19, fs: 13 });
  });
  s += txt(F, 'y', { px: F.X(0) - 8, py: F.pad.t - 4, fs: 13, style: 'italic' });
  s += txt(F, 'x', { px: F.w - F.pad.r + 6, py: F.Y(0) - 8, fs: 13, style: 'italic' });
  return s + F.close;
}

/* 5. 跟踪训练2(1) 图（原图 image4） */
function wave() {
  const F = box({ id: 'i5', w: 480, h: 250, xr: [-1.7, 5.7], yr: [-1.0, 3.2], pad: { l: 34, r: 30, t: 18, b: 32 } });
  const ctrl = [[-1, 2.55], [0, 0], [2, 2], [4, 0], [5, 2.55]];
  const pts = ctrl.map(p => [F.X(p[0]), F.Y(p[1])]);
  let s = axes(F);
  s += `<path d="${smooth(pts)}" fill="none" stroke="${INK}" stroke-width="2.4" stroke-linecap="round"/>`;
  ctrl.forEach(p => { s += dashV(F, p[0], p[1], 0); s += pt(F, p[0], p[1]); });
  [[-1, '−1'], [1, '1'], [2, '2'], [3, '3'], [4, '4'], [5, '5']].forEach(([v, lab]) => {
    s += txt(F, lab, { px: F.X(v), py: F.Y(0) + 19, fs: 12.5 });
  });
  s += txt(F, 'O', { px: F.X(0) - 8, py: F.Y(0) - 8, fs: 13, style: 'italic', anchor: 'end' });
  s += txt(F, 'y', { px: F.X(0) - 8, py: F.pad.t - 4, fs: 13, style: 'italic' });
  s += txt(F, 'x', { px: F.w - F.pad.r + 4, py: F.Y(0) - 8, fs: 13, style: 'italic' });
  return s + F.close;
}

/* 6. 跟踪训练2(2) 图（原图 image10） */
function absq2() {
  const F = box({ id: 'i6', w: 380, h: 330, xr: [-4.6, 6.6], yr: [-4.2, 13.4], pad: { l: 44, r: 28, t: 20, b: 32 } });
  const g = x => x * x - 2 * x - 3;
  let s = axes(F);
  let neg = [];
  for (let i = 0; i <= 160; i++) {
    const x = -3.4 + 8.8 * i / 160, y = g(x);
    if (y > 0 || y < -4.4) continue;
    neg.push([F.X(x), F.Y(y)]);
  }
  s += `<path d="${smooth(neg)}" fill="none" stroke="${MUT}" stroke-width="1.4" stroke-dasharray="6 5"/>`;
  const solid = [];
  for (let i = 0; i <= 220; i++) {
    const x = -3.4 + 9.6 * i / 220;
    const y = Math.abs(g(x));
    if (y > 13.6) continue;
    solid.push([F.X(x), F.Y(y)]);
  }
  s += `<path d="${smooth(solid)}" fill="none" stroke="${INK}" stroke-width="2.4" stroke-linecap="round"/>`;
  s += pt(F, -1, 0) + pt(F, 3, 0) + pt(F, 1, 4);
  [[-3, '−3'], [-1, '−1'], [3, '3'], [5, '5']].forEach(([v, lab]) => {
    s += txt(F, lab, { px: F.X(v), py: F.Y(0) + 19, fs: 12.5 });
  });
  [3, 6, 9, 12].forEach(v => {
    s += `<line x1="${F.X(0) - 3}" y1="${F.Y(v)}" x2="${F.X(0) + 3}" y2="${F.Y(v)}" stroke="${GREY}" stroke-width="1"/>`;
    s += txt(F, v, { px: F.X(0) - 9, py: F.Y(v) + 4, fs: 11.5, anchor: 'end' });
  });
  s += txt(F, 'O', { px: F.X(0) - 8, py: F.Y(0) - 8, fs: 13, style: 'italic', anchor: 'end' });
  s += txt(F, 'f(x)=|x²−2x−3|', { px: F.X(1.35), py: F.Y(6.9), fs: 12, anchor: 'start' });
  s += txt(F, 'y', { px: F.X(0) - 8, py: F.pad.t - 4, fs: 13, style: 'italic' });
  s += txt(F, 'x', { px: F.w - F.pad.r + 4, py: F.Y(0) - 8, fs: 13, style: 'italic' });
  return s + F.close;
}

/* 7. 当堂达标1 图（原图 image6） */
function exam() {
  const F = box({ id: 'i7', w: 450, h: 270, xr: [-5.7, 5.7], yr: [-2.6, 3.6], pad: { l: 36, r: 26, t: 20, b: 32 } });
  const ctrl = [[-5, -1.8], [-3, 2.2], [1, 1.3], [4, 2.9], [5, 1.2]];
  const pts = ctrl.map(p => [F.X(p[0]), F.Y(p[1])]);
  let s = axes(F);
  s += `<path d="${smooth(pts)}" fill="none" stroke="${INK}" stroke-width="2.4" stroke-linecap="round"/>`;
  ctrl.forEach(p => { s += dashV(F, p[0], p[1], 0); s += pt(F, p[0], p[1]); });
  [[-5, '−5'], [-4, '−4'], [-3, '−3'], [-2, '−2'], [-1, '−1'], [1, '1'], [2, '2'], [3, '3'], [4, '4'], [5, '5']].forEach(([v, lab]) => {
    s += txt(F, lab, { px: F.X(v), py: F.Y(0) + 19, fs: 12 });
  });
  [3, 2, 1, -1, -2].forEach(v => {
    s += `<line x1="${F.X(0) - 3}" y1="${F.Y(v)}" x2="${F.X(0) + 3}" y2="${F.Y(v)}" stroke="${GREY}" stroke-width="1"/>`;
    s += txt(F, v, { px: F.X(0) - 8, py: F.Y(v) + 4, fs: 11, anchor: 'end' });
  });
  s += txt(F, 'O', { px: F.X(0) + 7, py: F.Y(0) - 8, fs: 12.5, style: 'italic', anchor: 'start' });
  s += txt(F, 'y', { px: F.X(0) - 8, py: F.pad.t - 2, fs: 13, style: 'italic' });
  s += txt(F, 'x', { px: F.w - F.pad.r + 4, py: F.Y(0) - 8, fs: 13, style: 'italic' });
  return s + F.close;
}

const FIGS = { incr, decr, counter, absq, wave, absq2, exam };
module.exports = { FIGS };
