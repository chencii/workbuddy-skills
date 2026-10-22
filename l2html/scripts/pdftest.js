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
  await page.goto('file://' + file, { waitUntil: 'networkidle0' });
  await page.evaluate(() => window.__preparePrint());
  await new Promise(r => setTimeout(r, 300));
  await page.pdf({ path: process.argv[3], printBackground: true, preferCSSPageSize: true, margin: {top:0,bottom:0,left:0,right:0} });
  await browser.close();
  console.log('pdf ok');
})();
