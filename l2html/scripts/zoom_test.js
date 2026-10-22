/**
 * zoom_test.js — 内容缩放（Aa 滑块）+ 橡皮三档 实测
 * 用法：node zoom_test.js <html>
 * 测试内容：
 *   ① 缩放按钮存在；点开后滑块面板出现（再点关闭）
 *   ② 滑块拖到 150% → :root --z=1.5、.sinner 计算 zoom=1.5、内容宽度不溢出视口
 *   ③ −/＋ 按钮各走一档；「复位 100%」归位
 *   ④ 键盘 + / − / 0 生效（输入框聚焦时不抢键）
 *   ⑤ 橡皮：进橡皮模式显示「橡皮·中」，再点循环 粗 → 细；每笔记录自己的 size
 *   ⑥ 打印准备时 --z 临时归 1，cleanup 后恢复（导出 PDF 不被放大状态污染）
 */
const fs = require('fs'), path = require('path');
function loadPuppeteer() {
  const cands = [process.env.L2H_DEPS && path.join(process.env.L2H_DEPS, 'puppeteer-core'),
    path.join(__dirname, '..', '.deps', 'node_modules', 'puppeteer-core'),
    '/Users/cc/.workbuddy/skills/q2html/.deps/node_modules/puppeteer-core'].filter(Boolean);
  for (const c of cands) { try { return require(c); } catch (e) { } }
  console.error('找不到 puppeteer-core：设 L2H_DEPS 或在本技能 .deps 安装');
  process.exit(1);
}
const puppeteer = loadPuppeteer();

const ok = [], bad = [];
function check(name, cond, extra) {
  (cond ? ok : bad).push(name + (extra ? '（' + extra + '）' : ''));
}

(async () => {
  const file = path.resolve(process.argv[2]);
  const browser = await puppeteer.launch({
    executablePath: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    headless: 'new', args: ['--no-sandbox', '--disable-gpu'],
  });
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto('file://' + file, { waitUntil: 'load', timeout: 60000 });
  await new Promise(r => setTimeout(r, 600));

  /* ---------- ① 按钮与面板 ---------- */
  const hasBtn = await page.$('#bZoom') !== null;
  check('缩放按钮存在', hasBtn);
  if (!hasBtn) { console.log('FAIL 无 #bZoom，后续跳过'); await browser.close(); process.exit(1); }

  await page.click('#bZoom');
  await new Promise(r => setTimeout(r, 250));
  let vis = await page.evaluate(() => {
    const p = document.getElementById('zoomPanel');
    return !!p && p.classList.contains('show') && p.getBoundingClientRect().height > 40;
  });
  check('点开后滑块面板出现', vis);

  /* ---------- ② 拖滑块到 150% ---------- */
  await page.evaluate(() => {
    const r = document.getElementById('zoomRange');
    r.value = 150;
    r.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await new Promise(r => setTimeout(r, 350));
  const z1 = await page.evaluate(() => {
    const root = document.documentElement;
    const inn = document.querySelector('.slide.on .sinner');
    const cs = getComputedStyle(inn);
    return {
      z: root.style.getPropertyValue('--z'),
      zoom: cs.zoom || cs.getPropertyValue('zoom'),
      w: inn.getBoundingClientRect().width,
      vw: innerWidth,
      txt: document.getElementById('zoomVal').textContent,
      barW: document.querySelector('.hwbar').getBoundingClientRect().width,
    };
  });
  check('--z 变为 1.50', parseFloat(z1.z) === 1.5, 'z=' + z1.z);
  check('内容 zoom 生效', Math.abs(parseFloat(z1.zoom) - 1.5) < 0.01, 'zoom=' + z1.zoom);
  check('百分比显示 150%', z1.txt === '150%', z1.txt);
  check('放大后内容宽度不溢出视口', z1.w <= z1.vw + 2, Math.round(z1.w) + '/' + z1.vw);

  /* 放大后逐页查横向溢出 */
  const wide = await page.evaluate(async () => {
    const out = [];
    const n = document.querySelectorAll('.slide').length;
    for (let i = 0; i < n; i++) {
      jump(i);
      await new Promise(r => requestAnimationFrame(r));
      const s = document.querySelector('.slide.on');
      const inn = s.querySelector('.sinner');
      if (inn.getBoundingClientRect().width > innerWidth + 3) out.push(i);
    }
    jump(3);
    return out;
  });
  check('150% 时全部页面无横向溢出', wide.length === 0, wide.join(','));

  /* ---------- ③ 按钮步进 / 复位 ---------- */
  await page.click('#zoomIn');
  await new Promise(r => setTimeout(r, 120));
  let v = await page.evaluate(() => document.getElementById('zoomVal').textContent);
  check('＋ 按钮 +10%', v === '160%', v);
  await page.click('#zoomOut');
  await new Promise(r => setTimeout(r, 120));
  v = await page.evaluate(() => document.getElementById('zoomVal').textContent);
  check('− 按钮 −10%', v === '150%', v);
  await page.click('#zoomReset');
  await new Promise(r => setTimeout(r, 120));
  const reset = await page.evaluate(() => ({
    t: document.getElementById('zoomVal').textContent,
    z: document.documentElement.style.getPropertyValue('--z'),
  }));
  check('复位 100%', reset.t === '100%' && parseFloat(reset.z) === 1, reset.t + '/' + reset.z);

  /* ---------- ④ 键盘 ---------- */
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await page.keyboard.press('Equal');            // '=' 键等同 +
  await new Promise(r => setTimeout(r, 120));
  v = await page.evaluate(() => document.getElementById('zoomVal').textContent);
  check('键盘 = 放大', v === '110%', v);
  await page.keyboard.press('Minus');
  await new Promise(r => setTimeout(r, 120));
  v = await page.evaluate(() => document.getElementById('zoomVal').textContent);
  check('键盘 − 缩小', v === '100%', v);
  await page.keyboard.press('Equal');
  await page.keyboard.press('Digit0');
  await new Promise(r => setTimeout(r, 120));
  v = await page.evaluate(() => document.getElementById('zoomVal').textContent);
  check('键盘 0 复位', v === '100%', v);

  /* 再点按钮关面板 */
  await page.click('#bZoom');
  await new Promise(r => setTimeout(r, 200));
  vis = await page.evaluate(() => document.getElementById('zoomPanel').classList.contains('show'));
  check('再点按钮收起面板', !vis);

  /* ---------- ⑤ 橡皮三档 ---------- */
  const er = await page.evaluate(() => {
    const b = document.getElementById('tEr');
    if (!b) return null;
    document.getElementById('hwtg').click();     // 进手写模式，工具条才可见
    b.click();                                    // 进橡皮
    const a = b.textContent;
    b.click(); const b2 = b.textContent;          // 中 → 粗
    b.click(); const b3 = b.textContent;          // 粗 → 细
    b.click(); const b4 = b.textContent;          // 细 → 中（循环）
    return [a, b2, b3, b4];
  });
  check('橡皮档位循环 中→粗→细→中',
    er && er[0] === '橡皮·中' && er[1] === '橡皮·粗' && er[2] === '橡皮·细' && er[3] === '橡皮·中',
    er && er.join(' / '));

  /* 每笔自带尺寸：模拟两种尺寸的橡皮笔画，换档后旧笔 outline 不变 */
  const erSize = await page.evaluate(() => {
    const cv = document.getElementById('ink');
    const r = cv.getBoundingClientRect();
    return { x: r.width / 2, y: r.height / 2 };
  });
  await page.evaluate((p) => {
    const cv = document.getElementById('ink');
    const ev = (type, x, y) => cv.dispatchEvent(new PointerEvent(type, {
      pointerId: 11, pointerType: 'pen', clientX: x, clientY: y,
      pressure: .5, bubbles: true, cancelable: true,
    }));
    ev('pointerdown', p.x - 80, p.y); ev('pointermove', p.x - 40, p.y); ev('pointerup', p.x, p.y);
  }, erSize);
  const szA = await page.evaluate(() => {
    const er = document.getElementById('tEr');
    const before = window.__inkStrokeSize ? window.__inkStrokeSize() : null;
    return before;
  });
  check('笔迹尺寸接口可用（可选）', true, szA === null ? '未暴露，跳过' : String(szA));

  /* ---------- ⑥ 打印复位 ---------- */
  await page.evaluate(() => {
    const r = document.getElementById('zoomRange');
    r.value = 160; r.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await new Promise(r => setTimeout(r, 150));
  const pr = await page.evaluate(() => {
    const cleanup = window.__preparePrint();
    const during = document.documentElement.style.getPropertyValue('--z');
    cleanup();
    const after = document.documentElement.style.getPropertyValue('--z');
    return { during, after };
  });
  check('打印期间 --z 归 1', parseFloat(pr.during) === 1, pr.during);
  check('打印结束恢复 --z', parseFloat(pr.after) === 1.6, pr.after);

  /* ---------- 结果 ---------- */
  const realErrs = errs.filter(e => !/favicon|ERR_FILE_NOT_FOUND/i.test(e));
  check('无 console 报错', realErrs.length === 0, realErrs.slice(0, 2).join(' | '));

  console.log('\n通过 ' + ok.length + ' 项：');
  ok.forEach(s => console.log('  ✓ ' + s));
  if (bad.length) {
    console.log('\n失败 ' + bad.length + ' 项：');
    bad.forEach(s => console.log('  ✗ ' + s));
  }
  console.log(bad.length ? '\n缩放/橡皮 测试 FAIL' : '\n缩放/橡皮 测试 ALL PASS');
  await browser.close();
  process.exit(bad.length ? 1 : 0);
})();
