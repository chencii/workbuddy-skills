/**
 * fs_font_test.js — 全屏按钮 + 字号随屏幕缩放 实测
 * 用法：node fs_font_test.js <html>
 * 测试内容：
 *   ① 三种视口（1366×768 / 1920×1080 / 3840×2160）下正文/标题/按钮的计算字号
 *   ② 每种视口逐页内容溢出检测
 *   ③ 全屏按钮：存在性、点击进入/退出全屏、按钮文案与 .on 状态同步、F 快捷键
 */
const fs = require('fs'), path = require('path');
/* puppeteer-core 解析：L2H_DEPS > 本技能 .deps > q2html 技能 .deps（本机复用） */
function loadPuppeteer() {
  const cands = [process.env.L2H_DEPS && path.join(process.env.L2H_DEPS, 'puppeteer-core'),
    path.join(__dirname, '..', '.deps', 'node_modules', 'puppeteer-core'),
    '/Users/cc/.workbuddy/skills/q2html/.deps/node_modules/puppeteer-core'].filter(Boolean);
  for (const c of cands) { try { return require(c); } catch (e) { } }
  console.error('找不到 puppeteer-core：设 L2H_DEPS 或在本技能 .deps 安装');
  process.exit(1);
}
const puppeteer = loadPuppeteer();

const VIEWPORTS = [
  { name: '1366×768（老投影）', w: 1366, h: 768 },
  { name: '1920×1080（高清屏）', w: 1920, h: 1080 },
  { name: '3840×2160（4K 白板）', w: 3840, h: 2160 },
];

(async () => {
  const file = path.resolve(process.argv[2]);
  const browser = await puppeteer.launch({
    executablePath: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    headless: 'new',
    args: ['--no-sandbox', '--disable-gpu'],
  });
  const errs = [];

  console.log('════════ ① 字号随屏幕缩放 ════════');
  for (const vp of VIEWPORTS) {
    const page = await browser.newPage();
    page.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
    await page.setViewport({ width: vp.w, height: vp.h, deviceScaleFactor: 1 });
    await page.goto('file://' + file, { waitUntil: 'load', timeout: 60000 });
    await new Promise(r => setTimeout(r, 400));
    // 跳到第 5 页（有正文段落的一页）测字号
    await page.evaluate(() => jump(4));
    await new Promise(r => setTimeout(r, 200));
    const m = await page.evaluate(() => {
      const cs = el => el ? parseFloat(getComputedStyle(el).fontSize) : null;
      const slide = document.querySelector('.slide.on');
      return {
        body: cs(document.body),
        p: cs(slide.querySelector('.p, .lead, .dt .dtc')),
        title: cs(slide.querySelector('.ptitle')),
        nav: cs(document.getElementById('bNext')),
        pgn: (document.getElementById('pgn') || {}).textContent || '',
      };
    });
    // 逐页溢出检测（只看真实内容，不看底部预留）
    const over = await page.evaluate(async () => {
      const out = [];
      const n = document.querySelectorAll('.slide').length;
      for (let i = 0; i < n; i++) {
        jump(i);
        await new Promise(r => requestAnimationFrame(r));
        const s = document.querySelector('.slide.on');
        const inner = s.querySelector('.sinner');
        const bottom = inner.getBoundingClientRect().bottom;
        const limit = s.clientHeight + s.getBoundingClientRect().top;
        if (bottom > limit + 4) out.push((i + 1) + ':' + Math.round(bottom - limit) + 'px');
      }
      return out;
    });
    console.log(`  ${vp.name.padEnd(18)} 正文 ${m.p}px｜标题 ${m.title}px｜翻页钮 ${m.nav}px｜页码 ${m.pgn}｜溢出 ${over.length ? over.join(',') : '无'}`);
    await page.close();
  }

  console.log('════════ ② 全屏按钮行为 ════════');
  const page = await browser.newPage();
  page.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
  await page.setViewport({ width: 1920, height: 1080 });
  await page.goto('file://' + file, { waitUntil: 'load', timeout: 60000 });
  await new Promise(r => setTimeout(r, 400));

  const exists = await page.$('#bFs');
  console.log('  按钮存在: ' + (exists ? '是' : '否'));
  const label0 = await page.$eval('#bFs .fs-t', e => e.textContent);
  const vis = await page.$eval('#bFs', e => getComputedStyle(e).display !== 'none');
  console.log('  初始文案: ' + label0 + '（1080p 下可见: ' + vis + '）');

  // 点击进入全屏
  await page.click('#bFs');
  await new Promise(r => setTimeout(r, 400));
  const st1 = await page.evaluate(() => ({
    fs: !!(document.fullscreenElement || document.webkitFullscreenElement),
    label: (document.querySelector('#bFs .fs-t') || {}).textContent,
    on: document.getElementById('bFs').classList.contains('on'),
  }));
  console.log('  点击后: fullscreenElement=' + st1.fs + '｜文案=' + st1.label + '｜.on=' + st1.on);

  // 快捷键 F 退出
  await page.keyboard.press('f');
  await new Promise(r => setTimeout(r, 400));
  const st2 = await page.evaluate(() => ({
    fs: !!(document.fullscreenElement || document.webkitFullscreenElement),
    label: (document.querySelector('#bFs .fs-t') || {}).textContent,
    on: document.getElementById('bFs').classList.contains('on'),
  }));
  console.log('  按 F 后: fullscreenElement=' + st2.fs + '｜文案=' + st2.label + '｜.on=' + st2.on);

  // 再次 F 进入，然后程序化退出（模拟 Esc）
  await page.keyboard.press('f');
  await new Promise(r => setTimeout(r, 300));
  await page.evaluate(() => { const d = document; (d.exitFullscreen || d.webkitExitFullscreen).call(d); });
  await new Promise(r => setTimeout(r, 400));
  const st3 = await page.evaluate(() => ({
    fs: !!(document.fullscreenElement || document.webkitFullscreenElement),
    label: (document.querySelector('#bFs .fs-t') || {}).textContent,
    on: document.getElementById('bFs').classList.contains('on'),
  }));
  console.log('  Esc 退出后: fullscreenElement=' + st3.fs + '｜文案=' + st3.label + '｜.on=' + st3.on);

  // 窄屏（390×844 手机）应隐藏全屏按钮
  const mp = await browser.newPage();
  await mp.setViewport({ width: 390, height: 844 });
  await mp.goto('file://' + file, { waitUntil: 'load', timeout: 60000 });
  await new Promise(r => setTimeout(r, 300));
  const mvis = await mp.$eval('#bFs', e => getComputedStyle(e).display);
  console.log('  390px 手机: 全屏按钮 display=' + mvis + '（none=已隐藏）');
  await mp.close();

  await browser.close();
  const pass = st1.fs && st1.label === '退出全屏' && st1.on
    && !st2.fs && st2.label === '全屏' && !st2.on
    && !st3.fs && st3.label === '全屏' && !st3.on;
  console.log(errs.length ? 'CONSOLE ERRORS:\n' + errs.slice(0, 5).join('\n') : 'no console errors');
  console.log(pass && errs.length === 0 ? '全屏按钮 ALL PASS' : '全屏按钮有FAIL（见上）');
  process.exit(pass && errs.length === 0 ? 0 : 1);
})();
