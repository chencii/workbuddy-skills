#!/usr/bin/env node
/**
 * verify_deck.js — 生成的课件自检（改过版式/打印/手写之后务必跑一遍）
 *
 *   node verify_deck.js <课件.html> [浏览器路径]
 *
 * 检查三件事：
 *   ① 内容不被左下角工具栏遮挡（最容易回归的问题）—— 3 种视口 × 每一页，展开全部答案后滚到底
 *   ② 打印导出准备工作正常（每页有命名页尺寸、笔迹 SVG 数正确、清理后归零）
 *   ③ 手写笔迹跟着内容滚动（滚动前后同一笔的屏幕位置应差 = 滚动量）
 *
 * 依赖 puppeteer-core（首次运行自动装到 <skill>/.deps）。
 */
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const DEPS = path.join(__dirname, '..', '.deps');
const DEPS_MODULES = path.join(DEPS, 'node_modules');

function ensure(rel) {
  const p = path.join(DEPS_MODULES, rel);
  if (fs.existsSync(p)) return;
  console.log('[setup] 安装自检依赖…');
  fs.mkdirSync(DEPS, { recursive: true });
  if (!fs.existsSync(path.join(DEPS, 'package.json')))
    fs.writeFileSync(path.join(DEPS, 'package.json'), JSON.stringify({ name: 'exercise-deck-deps', private: true }, null, 1));
  try {
    cp.execSync(`npm install --prefix "${DEPS}" --no-audit --no-fund --no-bin-links puppeteer-core`, { stdio: 'inherit' });
  } catch (e) {
    console.error('\n依赖安装失败（沙箱可能拦了 npm）。请手动执行：\n' +
      `  cd "${DEPS}" && npm install --no-audit --no-fund --no-bin-links puppeteer-core\n` +
      '装好后重跑本脚本即可。');
    process.exit(2);
  }
}
ensure('puppeteer-core');
const puppeteer = require(path.join(DEPS_MODULES, 'puppeteer-core'));

const BROWSERS = [
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge Beta',
  process.env.CHROME_PATH,
].filter(Boolean);

function findBrowser(arg) {
  for (const p of [arg, ...BROWSERS]) if (p && fs.existsSync(p)) return p;
  throw new Error('没找到浏览器，可用第二个参数指定路径');
}

const VPS = [
  { n: '手机', w: 390, h: 844 },
  { n: '平板', w: 810, h: 1080 },
  { n: '投影', w: 1280, h: 720 },
];

(async () => {
  const file = path.resolve(process.argv[2] || '');
  if (!file || !fs.existsSync(file)) {
    console.error('用法: node verify_deck.js <课件.html> [浏览器路径]');
    process.exit(1);
  }
  const browser = await puppeteer.launch({
    executablePath: findBrowser(process.argv[3]),
    headless: 'new',
    args: ['--no-sandbox', '--disable-gpu'],
  });
  const page = await browser.newPage();
  let fails = 0;

  // ---------- ① 遮挡检查 ----------
  console.log('\n① 工具栏遮挡检查');
  for (const vp of VPS) {
    await page.setViewport({ width: vp.w, height: vp.h, deviceScaleFactor: 1 });
    await page.goto('file://' + file, { waitUntil: 'load' });
    await new Promise(r => setTimeout(r, 250));
    const rep = await page.evaluate(() => {
      document.getElementById('hwtg').click();          // 展开手写工具（工具栏最高状态）
      const slides = [].slice.call(document.querySelectorAll('.slide'));
      slides.forEach(s => s.querySelectorAll('.ans').forEach(a => a.classList.add('open')));
      const rows = [];
      for (let i = 0; i < slides.length; i++) {
        slides.forEach((s, j) => s.classList.toggle('on', j === i));
        const sl = slides[i], inner = sl.querySelector('.sinner');
        if (!inner) continue;
        sl.scrollTop = 0; sl.scrollTop = sl.scrollHeight;
        const bar = document.querySelector('.hwbar').getBoundingClientRect();
        const nav = document.querySelector('.nav').getBoundingClientRect();
        const top = Math.min(bar.top, nav.top);
        let low = -1e9;
        inner.querySelectorAll('.astep,.line,.opt,.toc li').forEach(e => {
          const b = e.getBoundingClientRect().bottom;
          if (b > low) low = b;
        });
        rows.push({ page: i + 1, gap: Math.round(top - low) });
        sl.scrollTop = 0;
      }
      return rows;
    });
    const bad = rep.filter(r => r.gap < 8);
    const min = rep.slice().sort((a, b) => a.gap - b.gap)[0];
    console.log(`   ${vp.n.padEnd(3)}${vp.w}x${vp.h}  ${rep.length} 页  遮挡 ${bad.length} 页  最紧间隙 ${min.gap}px（第${min.page}页）${bad.length ? '  ✗' : '  ✓'}`);
    if (bad.length) { fails++; bad.slice(0, 5).forEach(r => console.log(`      第${r.page}页 gap=${r.gap}`)); }
  }

  // ---------- ② 打印准备 ----------
  console.log('\n② 打印导出准备');
  await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
  await page.goto('file://' + file, { waitUntil: 'load' });
  await new Promise(r => setTimeout(r, 250));
  const pr = await page.evaluate(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const cv = document.getElementById('ink');
    document.getElementById('hwtg').click();
    const ev = (t, x, y) => cv.dispatchEvent(new PointerEvent(t, { clientX: x, clientY: y, pressure: .5, bubbles: true, pointerId: 1, isPrimary: true }));
    ev('pointerdown', 200, 300); for (let i = 1; i <= 20; i++) ev('pointermove', 200 + i * 10, 300); ev('pointerup', 400, 300);
    await sleep(80);
    window.print = function () {};
    document.getElementById('tPrint').click();
    document.getElementById('tPrint').click();          // 连点两次应幂等
    await sleep(120);
    const nPages = document.querySelectorAll('.slide').length;
    const sheet = document.getElementById('printSheet');
    const named = sheet ? (sheet.textContent.match(/@page pgi\d+\{size:/g) || []).length : 0;
    const out = {
      命名页数: named, 页数: nPages,
      笔迹SVG数: document.querySelectorAll('svg.inkprint').length,
      样式表数: document.querySelectorAll('#printSheet').length,
    };
    window.dispatchEvent(new Event('afterprint'));
    out.清理后 = [document.querySelectorAll('#printSheet').length,
                 document.querySelectorAll('svg.inkprint').length,
                 document.querySelectorAll('.slide[class*="pgi"]').length].join('/');
    return out;
  });
  const ok2 = pr.命名页数 === pr.页数 && pr.笔迹SVG数 === 1 && pr.样式表数 === 1 && pr.清理后 === '0/0/0';
  console.log(`   ${pr.页数} 页 → 命名页 ${pr.命名页数} 个；笔迹 SVG ${pr.笔迹SVG数} 个（连点两次不叠加）；清理后 ${pr.清理后}  ${ok2 ? '✓' : '✗'}`);
  if (!ok2) fails++;

  // ---------- ③ 笔迹跟随内容 ----------
  console.log('\n③ 笔迹跟随内容滚动');
  const ir = await page.evaluate(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const cv = document.getElementById('ink'), ctx = cv.getContext('2d');
    const slides = [].slice.call(document.querySelectorAll('.slide'));
    let idx = 1, best = -1;
    for (let i = 1; i < slides.length; i++) {
      const d = slides[i].scrollHeight - slides[i].clientHeight;
      if (d > best) { best = d; idx = i; }
    }
    slides.forEach((s, j) => s.classList.toggle('on', j === idx));
    if (window.__onPage) window.__onPage(idx);
    await sleep(120);
    slides[idx].querySelectorAll('.ans').forEach(a => a.classList.add('open'));
    await sleep(200);
    const sl = slides[idx];
    const dpr = cv.width / innerWidth;
    const ev = (t, x, y) => cv.dispatchEvent(new PointerEvent(t, { clientX: x, clientY: y, pressure: .5, bubbles: true, pointerId: 1, isPrimary: true }));
    const box = () => {
      const d = ctx.getImageData(0, 0, cv.width, cv.height).data, W = cv.width;
      let y0 = 1e9, y1 = -1;
      for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 20) {
        const py = Math.floor((i / 4) / W); if (py < y0) y0 = py; if (py > y1) y1 = py;
      }
      return y1 < 0 ? null : { y: Math.round(y0 / dpr) };
    };
    if (!document.body.classList.contains('hw')) document.getElementById('hwtg').click();
    const S = Math.min(200, sl.scrollHeight - sl.clientHeight);
    sl.scrollTop = S; await sleep(150);
    ev('pointerdown', 150, 300); for (let i = 1; i <= 20; i++) ev('pointermove', 150 + i * 10, 300); ev('pointerup', 350, 300);
    await sleep(150);
    const atS = box();
    sl.scrollTop = 0; await sleep(250);
    const atTop = box();
    return { 可滚动量: Math.round(sl.scrollHeight - sl.clientHeight), 落笔时y: atS && atS.y, 滚回顶部y: atTop && atTop.y, 差值: atTop && atS ? atTop.y - atS.y : null };
  });
  const ok3 = ir.差值 !== null && Math.abs(ir.差值 - Math.min(200, ir.可滚动量)) <= 6;
  console.log(`   滚到 ${Math.min(200, ir.可滚动量)} 处落笔 y=${ir.落笔时y} → 滚回顶部 y=${ir.滚回顶部y}（差 ${ir.差值}，应≈${Math.min(200, ir.可滚动量)}）  ${ok3 ? '✓' : '✗'}`);
  if (!ok3) fails++;

  await browser.close();
  console.log(fails ? `\n结果：${fails} 项未通过 ✗` : '\n结果：全部通过 ✓');
  process.exit(fails ? 1 : 0);
})();
