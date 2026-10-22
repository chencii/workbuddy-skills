/**
 * shot.js — 逐页截图，用于人工核对版式
 * node shot.js <html> <outdir> [width] [height]
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

(async () => {
  const file = path.resolve(process.argv[2]);
  const outdir = path.resolve(process.argv[3] || 'shots');
  const W = parseInt(process.argv[4] || '1440', 10);
  const H = parseInt(process.argv[5] || '900', 10);
  fs.mkdirSync(outdir, { recursive: true });

  const browser = await puppeteer.launch({
    executablePath: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    headless: 'new',
    args: ['--no-sandbox', '--disable-gpu', '--force-device-scale-factor=1'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
  const errs = [];
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  page.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
  await page.goto('file://' + file, { waitUntil: 'load', timeout: 60000 });
  await new Promise(r => setTimeout(r, 500));

  const n = await page.$$eval('.slide', els => els.length);

  // 逐页：先显示全部 rv，再截图（另存一份“未揭示”版本用于检查首屏）
  for (let i = 0; i < n; i++) {
    await page.evaluate(i => { window.jump(i); }, i);
    await new Promise(r => setTimeout(r, 260));
    const tag = String(i).padStart(2, '0');
    await page.screenshot({ path: path.join(outdir, tag + '.png') });
    // 检查是否溢出（内容高度 > 可视高度）
    const info = await page.evaluate(() => {
      const s = document.querySelector('.slide.on');
      return { sh: s.scrollHeight, ch: s.clientHeight, over: s.scrollHeight - s.clientHeight };
    });
    if (info.over > 2) console.log('  page ' + tag + ' 需滚动 ' + info.over + 'px');
  }
  console.log('slides=' + n);
  if (errs.length) console.log('CONSOLE ERRORS:\n' + errs.slice(0, 10).join('\n'));
  else console.log('no console errors');
  await browser.close();
})();
