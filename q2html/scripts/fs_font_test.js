/**
 * fs_font_test.js — 全屏按钮 + 字号随屏幕缩放 实测（q2html）
 * 用法：node fs_font_test.js <html>
 *
 * 测四组：
 *   ① 三种视口（1366×768 / 1920×1080 / 3840×2160）下正文计算字号 + 逐页内容溢出
 *   ② 全屏按钮：存在性、点击进入/退出、文案与 .on 同步、F 快捷键、Esc 退出、390px 隐藏
 *   ③ 工具栏与页面真实文字矩形是否相交（全屏按钮会加宽工具栏，容易压住内容）
 *   ④ 练习页在各视口能放几道题（字号变大后排数会变，用来汇报）
 *
 * 与 l2html 技能的同名脚本同构，差异只在：q2html 多一份「工具栏遮挡」和「练习页题数」，
 * 且它的字号公式是 2.4vmin+10px（l2html 是 1.9vmin+8px）。
 */
const fs = require('fs'), path = require('path');

function loadPuppeteer() {
  const cands = [process.env.Q2H_DEPS && path.join(process.env.Q2H_DEPS, 'puppeteer-core'),
    path.join(__dirname, '..', '.deps', 'node_modules', 'puppeteer-core')].filter(Boolean);
  for (const c of cands) { try { return require(c); } catch (e) { } }
  console.error('找不到 puppeteer-core：设 Q2H_DEPS 或在 scripts/../.deps 安装');
  process.exit(1);
}
const puppeteer = loadPuppeteer();

const CHROME = process.env.CHROME ||
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge';

const VIEWPORTS = [
  { name: '1366×768（老投影）', w: 1366, h: 768 },
  { name: '1920×1080（高清屏）', w: 1920, h: 1080 },
  { name: '3840×2160（4K 白板）', w: 3840, h: 2160 },
];
/* 遮挡复测用的窄/中/宽档（全屏按钮约 60px，会把工具栏撑宽，必须重测） */
const OVERLAP_W = [320, 360, 390, 430, 560, 620, 660, 768, 860, 900, 1024, 1280, 1440, 1920];

(async () => {
  const file = path.resolve(process.argv[2]);
  const errs = [];
  let fail = 0;
  const ok = (c, msg) => { console.log((c ? '  ✓ ' : '  ✗ ') + msg); if (!c) fail++; };

  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--disable-gpu'],
  });

  /* ---------- ① 字号 + 逐页溢出 ---------- */
  console.log('════════ ① 字号随屏幕缩放 ════════');
  const sizes = {};
  for (const vp of VIEWPORTS) {
    const page = await browser.newPage();
    page.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
    await page.setViewport({ width: vp.w, height: vp.h, deviceScaleFactor: 1 });
    await page.goto('file://' + file, { waitUntil: 'networkidle0' });
    await new Promise(r => setTimeout(r, 2500));
    const r = await page.evaluate(() => {
      const body = getComputedStyle(document.body).fontSize;
      const n = document.querySelectorAll('.slide').length;
      return { body, n };
    });
    sizes[vp.name] = r.body;
    // 练习页题数必须先翻过去才会渲染（PRAC_SCRIPT 是进入页面时才 pick()）
    await page.evaluate(i => { if (window.jump) jump(i); }, r.n - 1);
    await new Promise(res => setTimeout(res, 900));
    const pracN = await page.evaluate(() =>
      document.querySelectorAll('.slide.on .prac-q').length);
    // 逐页溢出：.slide 是 overflow-y:auto 的滚动容器，scrollHeight>clientHeight 即溢出
    const over = await page.evaluate(() => {
      const bad = [];
      document.querySelectorAll('.slide').forEach((s, i) => {
        if (s.scrollHeight - s.clientHeight > 2) bad.push(i + ':' + (s.scrollHeight - s.clientHeight));
      });
      return bad;
    });
    console.log('  ' + vp.name.padEnd(20) + '正文 ' + r.body.padEnd(9) +
      '｜练习页 ' + (pracN ? pracN + ' 道' : '未生成') +
      '｜溢出 ' + (over.length ? over.join(' ') : '无'));
    if (over.length) fail++;
    await page.close();
  }
  const big = parseFloat(sizes['3840×2160（4K 白板）']);
  const mid = parseFloat(sizes['1920×1080（高清屏）']);
  ok(big >= 45, '4K 白板正文 ≥45px（实际 ' + sizes['3840×2160（4K 白板）'] + '）');
  ok(mid > parseFloat(sizes['1366×768（老投影）']), '1080p 字号大于 768p（' + mid + ' > ' + sizes['1366×768（老投影）'] + '）');

  /* ---------- ② 全屏按钮行为 ---------- */
  console.log('════════ ② 全屏按钮行为 ════════');
  {
    const page = await browser.newPage();
    page.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
    await page.setViewport({ width: 1920, height: 1080 });
    await page.goto('file://' + file, { waitUntil: 'networkidle0' });
    await new Promise(r => setTimeout(r, 2200));
    const st = () => page.evaluate(() => {
      const b = document.getElementById('bFs');
      return {
        has: !!b,
        fs: !!(document.fullscreenElement || document.webkitFullscreenElement),
        txt: b ? (b.querySelector('.fs-t') || {}).textContent : null,
        on: b ? b.classList.contains('on') : null,
        vis: b ? getComputedStyle(b).display : null,
      };
    });
    let s = await st();
    ok(s.has, '全屏按钮存在（#bFs）');
    ok(s.txt === '全屏' && s.on === false && s.fs === false, '初始：文案「全屏」、未全屏、无 .on');
    ok(s.vis !== 'none', '1080p 下可见（display=' + s.vis + '）');

    await page.click('#bFs');
    await new Promise(r => setTimeout(r, 500));
    s = await st();
    ok(s.fs === true, '点击后进入全屏（fullscreenElement=true）');
    ok(s.txt === '退出全屏' && s.on === true, '文案变「退出全屏」、.on=true');

    await page.keyboard.press('f');
    await new Promise(r => setTimeout(r, 500));
    s = await st();
    ok(s.fs === false && s.txt === '全屏' && s.on === false, '按 F 退出全屏，状态同步复位');

    await page.evaluate(() => window.__fsToggle());
    // 必须等 fullscreenElement 真的置位再按 Esc——进入全屏是异步的，
    // 提前按 Esc 会被浏览器忽略，然后误判成「Esc 无效」（2026-10-21 踩过）。
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 150));
      if (await page.evaluate(() => !!(document.fullscreenElement || document.webkitFullscreenElement))) break;
    }
    /* Esc 必须走 CDP：puppeteer 的 keyboard.press('Escape') 在无头下到不了
       浏览器自己的「Esc 退出全屏」处理逻辑（已用空白对照页验证：同一个键，
       keyboard.press 无效、CDP keyDown 有效）。 */
    const cdp = await page.target().createCDPSession();
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
    await new Promise(r => setTimeout(r, 600));
    s = await st();
    ok(s.fs === false, 'Esc 也能退出全屏');

    // 输入框里按 F 不应触发全屏（抽问插件有个人数输入框）。
    // 注意：那个 input 在 .roll-over 浮层里，浮层 display:none 时 focus() 是空操作，
    // 所以必须先点「抽问」把浮层打开（2026-10-21 踩过：直接 focus 无效，用例假失败）。
    const hasInput = await page.evaluate(() => !!document.querySelector('.roll-over input'));
    if (hasInput) {
      await page.evaluate(() => {
        const bs = [].slice.call(document.querySelectorAll('.tmr .wbtn'));
        const b = bs.find(x => (x.querySelector('.tx') || {}).textContent === '抽问');
        if (b) b.click();
      });
      await new Promise(r => setTimeout(r, 400));
      await page.evaluate(() => { const i = document.querySelector('.roll-over input'); if (i) i.focus(); });
      const focused = await page.evaluate(() => document.activeElement &&
        document.activeElement.tagName === 'INPUT');
      if (focused) {
        await page.keyboard.press('f');
        await new Promise(r => setTimeout(r, 500));
        s = await st();
        ok(s.fs === false, '聚焦输入框时按 F 不触发全屏');
      } else {
        console.log('  - 未能把焦点移进输入框，跳过该用例');
      }
      await page.evaluate(() => { const c = document.getElementById('rollClose'); if (c) c.click(); });
    } else {
      console.log('  - 本课件未启用抽问插件（无 input），跳过「输入框按 F」用例');
    }

    await page.setViewport({ width: 390, height: 844 });
    await new Promise(r => setTimeout(r, 400));
    s = await st();
    ok(s.vis === 'none', '390px 手机上全屏按钮 display=none（' + s.vis + '）');
    await page.close();
  }

  /* ---------- ③ 工具栏 vs 真实文字矩形 ---------- */
  console.log('════════ ③ 工具栏遮挡复测 ════════');
  for (const w of OVERLAP_W) {
    const page = await browser.newPage();
    try {
      await page.setViewport({ width: w, height: w < 500 ? 844 : 900 });
      await page.goto('file://' + file, { waitUntil: 'networkidle0' });
      await new Promise(r => setTimeout(r, 2000));
      const last = await page.evaluate(() => document.querySelectorAll('.slide').length - 1);
      const hits = [];
      for (const idx of [1, Math.max(1, last - 1), last]) {
        await page.evaluate(i => { if (window.jump) jump(i); }, idx);
        await new Promise(r => setTimeout(r, 650));
        const o = await page.evaluate(() => {
          const R = e => { const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom }; };
          const bar = R(document.getElementById('tmr'));
          const s = document.querySelector('.slide.on');
          const items = [];
          s.querySelectorAll('.q, .prac-hd, .prac-q, .less, .cover h1, .toc-prac, .toc').forEach(e => {
            const walk = document.createTreeWalker(e, NodeFilter.SHOW_TEXT);
            let n, box = null;
            while ((n = walk.nextNode())) {
              if (!n.textContent.trim()) continue;
              const rg = document.createRange(); rg.selectNodeContents(n);
              const r = rg.getBoundingClientRect();
              if (r.width === 0 && r.height === 0) continue;
              box = box ? { l: Math.min(box.l, r.left), r: Math.max(box.r, r.right), t: Math.min(box.t, r.top), b: Math.max(box.b, r.bottom) }
                : { l: r.left, r: r.right, t: r.top, b: r.bottom };
            }
            if (box) items.push({ cls: String(e.className).slice(0, 18), ...box });
          });
          return { bar, items };
        });
        const bad = o.items.filter(t => !(t.r <= o.bar.l || t.l >= o.bar.r || t.b <= o.bar.t || t.t >= o.bar.b));
        if (bad.length) hits.push('p' + idx + '×' + bad.length);
      }
      console.log('  宽' + String(w).padEnd(5) + (hits.length ? ' ✗ ' + hits.join(' ') : ' ✓'));
      if (hits.length) fail++;
    } catch (e) {
      console.log('  宽' + String(w).padEnd(5) + ' 出错: ' + e.message.slice(0, 50));
      fail++;
    }
    await page.close();
  }

  /* ---------- ④ 练习页题数 ---------- */
  console.log('════════ ④ 练习页题数（字号变大后的实际排数） ════════');
  for (const vp of [{ w: 1920, h: 1080 }, { w: 1600, h: 900 }, { w: 1440, h: 900 },
  { w: 1366, h: 768 }, { w: 1280, h: 720 }, { w: 1024, h: 768 }, { w: 810, h: 1080 }, { w: 390, h: 844 }]) {
    const page = await browser.newPage();
    await page.setViewport({ width: vp.w, height: vp.h });
    await page.goto('file://' + file, { waitUntil: 'networkidle0' });
    await new Promise(r => setTimeout(r, 2200));
    const last = await page.evaluate(() => document.querySelectorAll('.slide').length - 1);
    await page.evaluate(i => { if (window.jump) jump(i); }, last);
    await new Promise(r => setTimeout(r, 900));
    /* 抽题是随机的，题目长短差别很大，一轮数字说明不了问题。
       点两次「换一批」取三次样本，报区间。 */
    const ns = [];
    for (let k = 0; k < 3; k++) {
      ns.push(await page.evaluate(() => document.querySelectorAll('.slide.on .prac-q').length));
      if (k < 2) {
        await page.evaluate(() => { const b = document.getElementById('pracAgain'); if (b) b.click(); });
        await new Promise(r => setTimeout(r, 700));
      }
    }
    const sub = await page.evaluate(() => { const e = document.getElementById('pracSub'); return e ? e.textContent : ''; });
    console.log('  ' + (vp.w + '×' + vp.h).padEnd(11) + Math.min.apply(null, ns) + '~' + Math.max.apply(null, ns) +
      ' 道（三次抽样 ' + ns.join('/') + '）');
    await page.close();
  }

  console.log('\n控制台报错: ' + (errs.length ? errs.join('\n') : '无'));
  if (errs.length) fail++;
  console.log(fail ? ('\n结果：' + fail + ' 项未过 ✗') : '\n结果：全部通过 ✓');
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
