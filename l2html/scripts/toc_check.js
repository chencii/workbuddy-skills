/**
 * toc_check.js — 逐个点击封面目录链接，验证落地页是否正确
 * 用法：node toc_check.js <html>
 * 通过标准：每条目录链接点击后，当前页的页眉 tag 必须以该目录条目的中文数字开头。
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
  const browser = await puppeteer.launch({
    executablePath: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    headless: 'new',
    args: ['--no-sandbox', '--disable-gpu'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
  await page.goto('file://' + file, { waitUntil: 'load', timeout: 60000 });
  await new Promise(r => setTimeout(r, 400));

  // 读出目录条目：[中文数字, 标题]
  const entries = await page.$$eval('.cover .toc a', as => as.map(a => {
    const tn = a.querySelector('.tn'), tt = a.querySelector('.tt b');
    return [tn ? tn.textContent.trim() : '', tt ? tt.textContent.trim() : ''];
  }));
  console.log('目录条目 ' + entries.length + ' 条：' + entries.map(e => e[0] + e[1]).join(' / '));

  let fail = 0;
  for (const [num, name] of entries) {
    // 回到封面再点，保证每次点击都从同一状态出发
    await page.evaluate(() => window.jump(0));
    await new Promise(r => setTimeout(r, 60));
    const clicked = await page.evaluate(num => {
      const a = [].slice.call(document.querySelectorAll('.cover .toc a'))
        .find(x => x.querySelector('.tn') && x.querySelector('.tn').textContent.trim() === num);
      if (!a) return false;
      a.click();
      return true;
    }, num);
    if (!clicked) { console.log('  ✗ ' + num + ' ' + name + '：找不到链接'); fail++; continue; }
    await new Promise(r => setTimeout(r, 120));
    const info = await page.evaluate(() => {
      const s = document.querySelector('.slide.on');
      const tag = s ? (s.querySelector('.ptag') || {}).textContent || '' : '';
      const title = s ? (s.querySelector('.ptitle') || {}).textContent || '' : '';
      const pgn = (document.getElementById('pgn') || {}).textContent || '';
      return { tag: tag.trim(), title: title.trim(), pgn: pgn.trim() };
    });
    const ok = info.tag.indexOf(num) === 0;
    console.log((ok ? '  ✓ ' : '  ✗ ') + num + ' ' + name
      + ' → [' + info.pgn + '] ' + info.tag + '｜' + info.title.slice(0, 18));
    if (!ok) fail++;
  }

  // 顺带检查「回到首页」按钮：先跳到第 5 页，点 bHome 应回封面
  await page.evaluate(() => window.jump(5));
  await new Promise(r => setTimeout(r, 80));
  await page.click('#bHome');
  await new Promise(r => setTimeout(r, 120));
  const home = await page.evaluate(() => !!document.querySelector('.slide.on .sinner.cover'));
  console.log((home ? '  ✓ ' : '  ✗ ') + '「回到首页」按钮 → ' + (home ? '回到封面' : '未回封面'));
  if (!home) fail++;

  console.log(fail === 0 ? 'ALL PASS' : 'FAIL ' + fail + ' 项');
  if (errs.length) console.log('CONSOLE ERRORS:\n' + errs.slice(0, 5).join('\n'));
  await browser.close();
  process.exit(fail === 0 && errs.length === 0 ? 0 : 1);
})();
