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
  const browser = await puppeteer.launch({
    executablePath: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    headless: 'new', args: ['--no-sandbox', '--disable-gpu'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await page.goto('file://' + file, { waitUntil: 'load', timeout: 60000 });
  await new Promise(r => setTimeout(r, 500));

  const n = await page.$$eval('.slide', e => e.length);

  // 1) 翻页 + 页码（页数不足 4 时跳到最后一页，避免越界后页码检查形同虚设）
  await page.evaluate(n => jump(Math.min(3, n - 1)), n);
  await new Promise(r => setTimeout(r, 200));
  const pgn = await page.$eval('#pgn', e => e.textContent.trim());

  // 2) 答案折叠
  const boxes = await page.$$('.slide.on .tgbox .abtn');
  let opened = 0;
  if (boxes.length) {
    await boxes[0].click();
    await new Promise(r => setTimeout(r, 150));
    opened = await page.$$eval('.slide.on .tgbox.open', e => e.length);
  }

  // 3) 打印准备
  const pr = await page.evaluate(() => {
    const cleanup = window.__preparePrint();
    const st = document.getElementById('printSheet');
    const rules = st ? (st.textContent.match(/@page pgi/g) || []).length : -1;
    cleanup();
    return { rules, left: !!document.getElementById('printSheet') };
  });

  // 4) 逐页量一次溢出（只看真实内容，不看底部预留）
  const over = await page.evaluate(async () => {
    const out = [];
    const n = document.querySelectorAll('.slide').length;
    for (let i = 0; i < n; i++) {
      jump(i);
      await new Promise(r => requestAnimationFrame(r));
      const s = document.querySelector('.slide.on');
      const inner = s.querySelector('.sinner');
      const contentBottom = inner.getBoundingClientRect().bottom;
      const h = s.clientHeight + s.getBoundingClientRect().top;
      if (contentBottom > h + 4) out.push(i + ':' + Math.round(contentBottom - h));
    }
    return out;
  });

  console.log(JSON.stringify({ slides: n, pageNo: pgn, ansOpened: opened, print: pr, contentOverflow: over, errors: errs.slice(0, 5) }, null, 1));
  await browser.close();
})();
