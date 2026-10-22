#!/usr/bin/env node
/**
 * render_deck.js — 把「题目+答案」的结构化 JSON 渲染成**单文件 HTML 习题课件**
 *
 * 用法：node render_deck.js <deck.json> [out.html]
 *
 * 输出特性（都是单文件自包含，发给学生/同事直接能开）：
 *  - 第 1 页封面 + 目录（可点击跳转）；题目按课时分组、同课时两题一页，中间留板书位
 *  - 答案折叠（点「答案与解析」展开）
 *  - 左下角「✎ 手写」：黑笔/红笔/橡皮/清本页/清全部，笔迹按页面内容坐标存储，滚动跟着走
 *  - 「打印/存PDF（矢量）」：走浏览器原生打印管线，整章 0.4 秒、约 400KB、文字可选中
 *
 * 依赖（mathjax-full / perfect-freehand）首次运行会自动装到 <skill>/.deps 下。
 * 数据结构见 references/schema.md。
 */
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

// ---------- 依赖：首次运行自动安装 ----------
const DEPS = path.join(__dirname, '..', '.deps');
const DEPS_MODULES = path.join(DEPS, 'node_modules');
const PKGS = ['mathjax-full@3', 'perfect-freehand@1'];
let depsReady = false;
function ensureDeps() {
  if (depsReady) return;
  console.log('[setup] 首次运行，安装依赖到 ' + DEPS + ' …');
  fs.mkdirSync(DEPS, { recursive: true });
  if (!fs.existsSync(path.join(DEPS, 'package.json'))) {
    fs.writeFileSync(path.join(DEPS, 'package.json'), JSON.stringify({ name: 'q2html-deps', private: true }, null, 1));
  }
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  try {
    cp.execSync(`${npm} install --prefix "${DEPS}" --no-audit --no-fund --no-bin-links ${PKGS.join(' ')}`, { stdio: 'inherit' });
  } catch (e) {
    console.error('\n依赖安装失败（沙箱可能拦了 npm）。请手动执行：\n' +
      `  cd "${DEPS}" && npm install --no-audit --no-fund --no-bin-links ${PKGS.join(' ')}\n` +
      '装好后重跑即可。');
    process.exit(2);
  }
  depsReady = true;
}
function depModule(rel) {
  const p = path.join(DEPS_MODULES, rel);
  try { return require(p); }
  catch (e) { ensureDeps(); return require(p); }
}
function depFile(rel) {
  const p = path.join(DEPS_MODULES, rel);
  if (!fs.existsSync(p)) ensureDeps();
  return p;
}

/* ================= 公式预渲染（MathJax → 内联 SVG，离线可用） ================= */
const { mathjax } = depModule('mathjax-full/js/mathjax.js');
const { TeX } = depModule('mathjax-full/js/input/tex.js');
const { SVG } = depModule('mathjax-full/js/output/svg.js');
const { liteAdaptor } = depModule('mathjax-full/js/adaptors/liteAdaptor.js');
const { RegisterHTMLHandler } = depModule('mathjax-full/js/handlers/html.js');
const { AllPackages } = depModule('mathjax-full/js/input/tex/AllPackages.js');

const adaptor = liteAdaptor();
RegisterHTMLHandler(adaptor);
const texIn = new TeX({ packages: AllPackages, macros: {} });
const svgOut = new SVG({ fontCache: 'local' });
const doc = mathjax.document('', { InputJax: texIn, OutputJax: svgOut });

function tex2svg(latex) {
  const node = doc.convert(latex, { display: false, em: 16, ex: 8, containerWidth: 80 * 16 });
  let html = adaptor.outerHTML(node);
  // 去掉外层 mjx-container 的多余属性，保留样式与内部 svg
  html = html.replace(/^<mjx-container[^>]*>/, '').replace(/<\/mjx-container>$/, '');
  return html.trim();
}

// ---------- 工具 ----------
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const CJK = /[\u2e80-\u9fff\uff00-\uffef]/;

function isCJK(ch) { return ch && CJK.test(ch); }

/** 把一个 frag 序列渲染成 HTML；文本与公式之间按需留白 */
function fragsToHTML(frags, display) {
  let out = '';
  const items = frags.filter(f => f[1] !== '');
  for (let i = 0; i < items.length; i++) {
    const [k, v] = items[i];
    if (k === 'm') {
      const prev = items[i - 1], next = items[i + 1];
      let pad = '';
      const beforeCJK = prev && prev[0] === 't' && isCJK(prev[1].slice(-1));
      const afterCJK = next && next[0] === 't' && isCJK(next[1][0]);
      if (beforeCJK || afterCJK) pad = ' mx-pad';
      const latex = display ? '\\displaystyle ' + v : v;
      out += `<span class="mx${pad}">${tex2svg(latex)}</span>`;
    } else if (k === 't') {
      out += esc(v);
    }
  }
  return out;
}

function optsToHTML(items) {
  let h = '<div class="opts">';
  for (const it of items) {
    h += `<div class="opt"><span class="ol">${esc(it.label)}.</span>` +
         `<span class="ob">${fragsToHTML(it.frags)}</span></div>`;
  }
  return h + '</div>';
}

function labelLevel(lab) {
  if (!lab) return 0;
  if (/^[（(]/.test(lab)) return 1;
  if (/^[①②③④⑤⑥⑦⑧⑨⑩⑪⑫]$/.test(lab)) return 1;
  return 0;
}

function blockToHTML(b, isFirst) {
  if (b.type === 'opts') return optsToHTML(b.items);
  // 无编号的续行（仍属本题）缩进一级
  const lv = b.label ? labelLevel(b.label) : (isFirst ? 0 : 1);
  const disp = b.label ? (/^\d+$/.test(b.label) ? b.label + '.' : b.label) : '';
  const lbl = disp ? `<span class="ln">${esc(disp)}</span>` : '<span class="ln"></span>';
  // 整行只有一个大分式/分段函数（或标记 display）时，用 displaystyle 放大，更接近卷面
  const mathy = b.frags.filter(f => f[1] !== '');
  const solidMath = mathy.length && mathy.every(f =>
    f[0] === 'm' || (f[0] === 't' && /^[。．；;，,、]+$/.test(f[1])));
  const big = b.display || (solidMath && /\\frac|\\begin\{cases\}/.test(mathy.map(f => f[1]).join('')));
  return `<div class="line lv${lv}">${lbl}<span class="lb">${fragsToHTML(b.frags, big)}</span></div>`;
}

function ansToHTML(a) {
  if (!a) return '';
  const has = (a.key && a.key.length) || (a.steps && a.steps.length) || (a.note && a.note.length);
  if (!has) return '';
  let inner = '';
  if (a.key.length) {
    inner += '<div class="akey">' + a.key.map(e =>
      `<span class="ki">${e.label ? `<span class="kl">${esc(e.label)}</span>` : ''}` +
      `<span class="kv">${fragsToHTML(e.frags)}</span></span>`
    ).join('') + '</div>';
  }
  for (const st of a.steps) {
    inner += '<div class="astep">' +
      (st.label ? `<span class="alb">${esc(st.label)}</span>` : '') +
      `<span class="abody">${fragsToHTML(st.frags)}</span></div>`;
  }
  for (const nt of a.note) {
    inner += `<div class="anote">${fragsToHTML(nt)}</div>`;
  }
  return `<details class="ans"><summary><span class="tri"></span>答案与解析</summary>` +
         `<div class="ansbox">${inner}</div></details>`;
}

/* ================= 版式与交互（CSS + 手写层 + 打印导出） ================= */
const CSS = `
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
:root{
  /* 正文字号随屏幕短边缩放（vmin）；上限 46px 保证 4K 电子白板全屏时字也够大。
     小屏完全不变（cap 在 vmin≈833px 以上才起作用）：1366×768→28.4px、
     1920×1080→35.9px、3840×2160→46px（2026-10-21 从 30px 抬到 46px，
     与 l2html 技能对齐——原 cap 把大屏字锁死在小屏尺寸上）。 */
  --u: clamp(17px, 2.4vmin + 10px, 46px);
  --pad-x: clamp(16px, 4vmin, 64px);
  --pad-y: clamp(14px, 3vmin, 40px);
  --pri:#1F3A5F;
  --acc:#B8552F;
  --box:#FAF8F4;
  --chip:#E9EEF4;
  --rule:#D9D3C7;
  --sub: 2.1em;
  /* 左下角工具栏占位高度：默认值兜底，页面加载后由脚本按实测高度校准 */
  --barh: 150px;
  /* 内容缩放系数（右上角「Aa」滑块控制 0.8~2.0）。只作用于 .sinner，
     角落工具栏/页码不跟着放大；max-width 用 min(46em,100%) 锁在视口内。 */
  --z: 1;
}
html{-webkit-text-size-adjust:100%;text-size-adjust:100%;}
body{
  background:#fff;color:#222;
  font-family:"Songti SC","Source Han Serif SC","Noto Serif SC","SimSun",serif;
  font-size:var(--u);line-height:1.9;overflow:hidden;
}

/* ---------- 幻灯页 ----------
   底部预留 = 工具栏实测高度(--barh) + 额外冗余(6vh)，
   保证最后一题/最后一行能完整滑到左下角工具栏上方，不被遮挡 */
.slide{display:none;position:fixed;inset:0;overflow-y:auto;
  padding:calc(var(--pad-y) + 8px) var(--pad-x) calc(var(--pad-y) + 6vh);
  padding-bottom:calc(var(--pad-y) + var(--barh) + 6vh + env(safe-area-inset-bottom));
  -webkit-overflow-scrolling:touch;}
.slide.on{display:flex;flex-direction:column;animation:fade .22s ease;}
@keyframes fade{from{opacity:0;transform:translateX(14px);}to{opacity:1;transform:none;}}
.sinner{flex:0 0 auto;margin:auto;width:100%;zoom:var(--z);max-width:min(46em,100%);}
/* 题目页：同题型两题同页——第一题靠上，中间留空写板书；
   第二题居中、上下都留空（下方继续写板书） */
.sinner.qpage{display:flex;flex-direction:column;min-height:100%;
  justify-content:flex-start;margin:0 auto;}
/* 关键：题目块不允许被压缩。内容超高时整页滚动（能一直滑到工具栏上方），
   而不是被 flex 压扁后溢出到左下角工具栏底下被遮挡。 */
.sinner.qpage>*{flex:0 0 auto;}
.sinner.qpage.two .q:last-child{margin-top:auto;margin-bottom:auto;}
/* 封面：内容靠上，下方大量留白 */
.sinner.cover{margin:0 auto;padding-top:clamp(24px,7vh,80px);}

/* 封面 */
.cover{text-align:center;}
.cover .kicker{font-family:"PingFang SC","Microsoft YaHei",sans-serif;font-size:.56em;
  letter-spacing:.4em;color:var(--acc);font-weight:600;margin-bottom:1em;}
.cover h1{font-size:1.5em;font-weight:700;letter-spacing:.03em;line-height:1.5;}
.cover .dash{display:block;width:2.6em;height:3px;background:var(--acc);
  margin:.7em auto 1.4em;border-radius:2px;opacity:.85;}
.toc{text-align:left;display:block;margin:0 auto;padding:0;list-style:none;
  columns:2;column-gap:2.6em;font-size:.92em;line-height:1.7;}
.toc li{margin:.12em 0;break-inside:avoid;}
.toc a{color:var(--pri);text-decoration:none;display:flex;gap:.8em;align-items:baseline;
  padding:.18em .2em;border-radius:3px;transition:background .15s;}
.toc a:hover{background:#F2EEE6;}
.toc .no{flex:0 0 auto;font-weight:700;color:var(--acc);min-width:2.2em;text-align:right;}
.toc .nm{flex:1 1 auto;}

/* 「本节小练」：独立排在课时目录下方，不受两栏分布影响，位置永远固定 */
.toc-prac{display:flex;align-items:center;gap:.55em;
  margin:1.1em 0 0;padding:.6em .2em 0;border-top:1px solid var(--rule);
  color:var(--pri);text-decoration:none;font-weight:700;
  font-family:"PingFang SC","Microsoft YaHei",sans-serif;
  font-size:.78em;letter-spacing:.1em;
  transition:color .15s;}
.toc-prac:hover{color:var(--acc);}
.toc-prac .ico{flex:0 0 auto;display:inline-flex;align-items:center;justify-content:center;
  width:1.7em;height:1.7em;border-radius:5px;
  background:#F8F2EA;border:1px solid #EADFD0;
  color:var(--acc);font-size:.92em;line-height:1;}
.toc-prac .tip{margin-left:auto;font-weight:400;letter-spacing:.04em;
  font-size:.84em;color:#9a948a;}

/* 题目页眉：所属课时 */
.runt{display:flex;align-items:baseline;gap:.6em;margin-bottom:1em;
  font-family:"PingFang SC","Microsoft YaHei",sans-serif;}
.runt .lno{flex:0 0 auto;font-size:.56em;font-weight:700;letter-spacing:.1em;
  color:#fff;background:var(--pri);border-radius:2px;padding:.3em .6em;}
.runt .lnm{flex:1 1 auto;font-size:.6em;font-weight:600;letter-spacing:.06em;color:#8a857c;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}

/* 题目页：一页两题，题间留白 */
.q{margin-bottom:1.25em;}
.q:last-child{margin-bottom:0;}

/* ---------- 题干 ---------- */
.line{display:flex;gap:.5em;align-items:baseline;}
.ln{flex:0 0 auto;}
.line.lv0 .ln{min-width:1.9em;text-align:right;padding-right:.1em;font-weight:700;color:var(--pri);}
.line.lv0 .ln:empty{min-width:0;padding:0;}
.line.lv1{margin-left:var(--sub);}
.line.lv1 .ln{min-width:2.3em;color:#555;}
.lb{flex:1 1 auto;min-width:0;}
.mx{display:inline-block;vertical-align:baseline;max-width:100%;}
.mx svg{display:block;max-width:100%;height:auto;}
.lb .mx svg,.ob .mx svg,.ab .mx svg{overflow:visible;}
.mx.mx-pad{margin:0 .14em;}

/* ---------- 选项 ---------- */
.opts{display:flex;flex-wrap:wrap;gap:.1em 2.2em;margin:.25em 0 0 var(--sub);}
.opt{display:flex;gap:.4em;align-items:baseline;flex:0 1 auto;min-width:max-content;max-width:100%;}
.opt .ol{flex:0 0 auto;font-weight:600;color:var(--pri);}
.opt .ob{min-width:0;}

/* ---------- 答案折叠 ---------- */
.ans{margin-top:.55em;}
.abtn{
  font-family:"PingFang SC","Microsoft YaHei",sans-serif;
  font-size:.5em;font-weight:600;letter-spacing:.14em;
  color:var(--pri);background:#fff;
  border:1px solid var(--rule);border-radius:3px;
  padding:.62em 1.15em;cursor:pointer;
  transition:background .18s,color .18s,border-color .18s;
  -webkit-tap-highlight-color:transparent;
}
.abtn:hover{background:var(--pri);color:#fff;border-color:var(--pri);}
.abtn .mk{display:inline-block;margin-right:.5em;transition:transform .2s;font-size:.9em;}
.ans.open .abtn{background:var(--pri);color:#fff;border-color:var(--pri);}
.ans.open .abtn .mk{transform:rotate(90deg);}
.abody{display:none;margin-top:.6em;padding:.55em .85em;
       background:var(--box);border-left:3px solid var(--acc);border-radius:0 3px 3px 0;}
.ans.open .abody{display:block;animation:fadein .26s ease;}
@keyframes fadein{from{opacity:0;transform:translateY(-4px);}to{opacity:1;transform:none;}}
.astep{margin-top:.35em;line-height:1.9;}
.astep.dis{text-align:center;}
.astep .lb{
  display:inline-block;
  font-family:"PingFang SC","Microsoft YaHei",sans-serif;
  font-size:.62em;font-weight:600;letter-spacing:.1em;
  color:var(--pri);background:var(--chip);
  padding:.28em .6em;border-radius:2px;margin-right:.5em;
}
.astep .ab{display:inline;}

/* ---------- 右下角翻页 ---------- */
.nav{position:fixed;right:clamp(12px,2.6vmin,26px);bottom:calc(14px + env(safe-area-inset-bottom));
  z-index:50;display:flex;align-items:center;gap:.45em;
  font-family:"PingFang SC","Microsoft YaHei",sans-serif;}
.nav button{
  font-size:max(13px,.62em);font-weight:600;color:var(--pri);
  background:#fff;border:1px solid var(--rule);border-radius:5px;
  padding:.55em .95em;cursor:pointer;line-height:1;
  transition:background .16s,color .16s,border-color .16s;
  -webkit-tap-highlight-color:transparent;
}
.nav button:hover:not(:disabled){background:var(--pri);color:#fff;border-color:var(--pri);}
.nav button:disabled{opacity:.3;cursor:default;}
/* 首页按钮：与翻页键区分，弱化成次要样式 */
.nav #bHome{font-weight:500;color:var(--acc);background:transparent;border-style:dashed;}
.nav #bHome:hover:not(:disabled){background:var(--acc);border-color:var(--acc);color:#fff;}

/* ---------- 手写层 / 导出（仅 -尝试手写 版本注入） ---------- */
#ink{position:fixed;inset:0;z-index:45;pointer-events:none;touch-action:none;}
body.hw #ink{pointer-events:auto;cursor:crosshair;}
/* 手写模式：禁止长按选中文字、禁止弹系统菜单（iPad/手机长按会选中文字并打断书写） */
body.hw,body.hw *{-webkit-user-select:none!important;user-select:none!important;
  -webkit-touch-callout:none!important;-webkit-user-drag:none!important;}
.hwbar{position:fixed;left:clamp(12px,2.6vmin,26px);bottom:calc(14px + env(safe-area-inset-bottom));
  z-index:60;display:flex;flex-wrap:wrap;gap:.4em;align-items:center;
  max-width:calc(100vw - 24px);
  font-family:"PingFang SC","Microsoft YaHei",sans-serif;}
.hwbar button{
  font-size:max(13px,.62em);font-weight:600;color:var(--pri);
  background:#fff;border:1px solid var(--rule);border-radius:5px;
  padding:.55em .85em;cursor:pointer;line-height:1;white-space:nowrap;
  transition:background .16s,color .16s,border-color .16s;
  -webkit-tap-highlight-color:transparent;
}
.hwbar button:hover{background:var(--pri);color:#fff;border-color:var(--pri);}
#tPrint,#hwtg{background:var(--pri);color:#fff;border-color:var(--pri);}
body.hw #hwtg{background:#fff;color:var(--pri);}
/* 笔迹的打印副本：平时不显示，只在打印时出现（清理失败也不会影响屏幕） */
.inkprint{display:none;}
#hwtools{display:none;gap:.4em;align-items:center;flex-wrap:wrap;}
#hwtools.show{display:flex;}
.hwbar button.on{background:var(--acc);border-color:var(--acc);color:#fff;}
@media (max-width:600px){.hwbar{max-width:calc(100vw - 210px);}}

/* ---------- 窄屏 ---------- */
@media (max-width:600px){
  /* 手机端工具栏会折成多行，兜底值给大一些；页面加载后脚本会用实测高度覆盖 */
  :root{--barh:240px;}
}
@media (max-width:520px){
  :root{--sub:1.5em;}
  body{line-height:1.85;}
  .cover h1{font-size:1.2em;}
  .toc{columns:1;font-size:.95em;}
  .opts{gap:.05em 1.3em;}
  .opt{min-width:0;flex:1 1 7.5em;}
  .abtn{font-size:.54em;padding:.6em 1em;}
  .abody{padding:.4em .55em;margin-top:.4em;}
  .astep{line-height:1.75;margin-top:.3em;}
  .astep .lb{font-size:.62em;padding:.25em .5em;margin-right:.35em;}
}

/* ---------- 倒计时 ---------- */
/* max-width 原为 min(94vw,620px)。2026-10-21 加了全屏按钮后 7 颗按钮自然宽约 640px，
   620 会把工具栏挤成两行、反而压住练习页页眉，故抬到 700px。 */
.tmr{position:fixed;top:calc(10px + env(safe-area-inset-top));right:clamp(10px,2.4vmin,24px);
  z-index:55;display:flex;align-items:center;gap:.25em;
  font-family:"PingFang SC","Microsoft YaHei",sans-serif;}
.tmr-btn{font-size:max(12px,.56em);font-weight:600;color:var(--pri);background:#fff;
  border:1px solid var(--rule);border-radius:5px;padding:.42em .7em;cursor:pointer;line-height:1;
  font-variant-numeric:tabular-nums;white-space:nowrap;
  box-shadow:0 1px 4px rgba(0,0,0,.06);transition:background .16s,color .16s,border-color .16s;
  -webkit-tap-highlight-color:transparent;}
.tmr-btn:hover{background:var(--pri);color:#fff;border-color:var(--pri);}
/* ---------- 全屏按钮（2026-10-21 从 l2html 移植） ----------
   与计时器同工具栏，放在最左；.on = 正在全屏。
   作用：浏览器窗口化时 vmin 只是窗口尺寸，点了全屏 vmin 才变成屏幕尺寸，
   --u 才会随屏幕放大（1080p 35.9px / 4K 46px）。 */
.fs-btn{display:inline-flex;align-items:center;gap:.4em;}
.fs-btn svg{display:block;width:1.05em;height:1.05em;}
.fs-btn.on{background:var(--pri);color:#fff;border-color:var(--pri);}
.tmr .tmr-x{display:none;font-size:max(11px,.5em);color:#8a857c;cursor:pointer;padding:.2em .35em;
  border-radius:4px;line-height:1;}
.tmr .tmr-x:hover{background:#eee;color:#444;}
.tmr.run .tmr-x,.tmr.pause .tmr-x{display:inline-block;}
.tmr.run .tmr-btn{background:var(--pri);color:#fff;border-color:var(--pri);}
.tmr.pause .tmr-btn{opacity:.62;}
.tmr.warn .tmr-btn{background:var(--acc);border-color:var(--acc);color:#fff;
  animation:tmrPulse 1s ease-in-out infinite;}
@keyframes tmrPulse{0%,100%{transform:scale(1)}50%{transform:scale(1.07)}}
.tmr-menu{position:fixed;top:calc(46px + env(safe-area-inset-top));right:clamp(10px,2.4vmin,24px);z-index:56;
  display:none;grid-template-columns:1fr 1fr;gap:.3em;padding:.4em;
  background:#fff;border:1px solid var(--rule);border-radius:8px;
  box-shadow:0 8px 26px -10px rgba(0,0,0,.28);font-family:"PingFang SC","Microsoft YaHei",sans-serif;}
.tmr-menu.show{display:grid;animation:fadein .18s ease;}
.tmr-menu button{font-size:max(12px,.56em);font-weight:600;color:var(--pri);background:#fff;
  border:1px solid var(--rule);border-radius:5px;padding:.5em .8em;cursor:pointer;line-height:1;
  white-space:nowrap;-webkit-tap-highlight-color:transparent;}
.tmr-menu button:hover{background:var(--pri);color:#fff;border-color:var(--pri);}
/* 时间到：全屏提示 */
.tmr-over{position:fixed;inset:0;z-index:200;display:none;align-items:center;justify-content:center;
  background:radial-gradient(circle at center,rgba(31,58,95,.94),rgba(20,32,52,.98));overflow:hidden;}
.tmr-over.on{display:flex;animation:ovIn .28s ease both;}
@keyframes ovIn{from{opacity:0}to{opacity:1}}
.tmr-burst{position:absolute;width:42vmin;height:42vmin;border-radius:50%;
  border:6px solid rgba(255,255,255,.5);animation:burst 1.7s ease-out infinite;}
.tmr-burst::after{content:'';position:absolute;inset:-20%;border-radius:50%;
  border:4px solid rgba(255,255,255,.32);animation:burst 1.7s .3s ease-out infinite;}
@keyframes burst{0%{transform:scale(.3);opacity:.9}100%{transform:scale(2.8);opacity:0}}
.tmr-msg{position:relative;font-family:"PingFang SC","Microsoft YaHei",sans-serif;font-weight:800;
  font-size:clamp(46px,15vmin,150px);color:#fff;letter-spacing:.14em;line-height:1.1;
  text-shadow:0 8px 34px rgba(0,0,0,.4);
  animation:msgPop .55s cubic-bezier(.2,1.7,.4,1) both,msgGlow 2.2s 1s ease-in-out infinite;}
@keyframes msgPop{0%{transform:scale(.35);opacity:0}62%{transform:scale(1.1)}100%{transform:scale(1);opacity:1}}
@keyframes msgGlow{0%,100%{text-shadow:0 8px 34px rgba(0,0,0,.4)}50%{text-shadow:0 8px 46px rgba(255,255,255,.55)}}
.tmr-sub{position:absolute;bottom:20%;color:rgba(255,255,255,.82);font-family:"PingFang SC","Microsoft YaHei",sans-serif;
  font-size:clamp(13px,2.4vmin,22px);letter-spacing:.22em;font-weight:500;}
@media print{.tmr,.tmr-menu,.tmr-over,.zoom-panel{display:none!important;}}
/* 手机本身即全屏应用，且 iOS 不支持元素全屏，隐藏免误点（与 l2html 一致用 620px 断点） */
@media (max-width:620px){#bFs{display:none!important;}}

/* 缩放按钮 + 面板：Aa 点开滑块，80%~200%（投屏看不清时直接放大整页内容） */
.zm-btn{font-variant-numeric:normal;letter-spacing:0;}
.zm-btn b{font-size:1.12em;font-weight:800;letter-spacing:-.02em;}
.zm-btn.on{background:var(--pri);color:#fff;border-color:var(--pri);}
.zoom-panel{position:fixed;top:calc(46px + env(safe-area-inset-top));right:clamp(10px,2.4vmin,24px);
  z-index:57;display:none;width:min(272px,86vw);padding:.72em .82em .62em;
  background:#fff;border:1px solid var(--rule);border-radius:9px;
  box-shadow:0 8px 26px -10px rgba(0,0,0,.28);
  font-family:"PingFang SC","Microsoft YaHei",sans-serif;}
.zoom-panel.show{display:block;animation:zpIn .16s ease;}
@keyframes zpIn{from{opacity:0;transform:translateY(-5px)}to{opacity:1;transform:none}}
.zoom-panel .zp-head{display:flex;justify-content:space-between;align-items:baseline;
  font-size:max(12px,.56em);color:#8a857c;letter-spacing:.08em;margin-bottom:.55em;}
.zoom-panel .zp-head b{font-size:max(15px,.78em);color:var(--pri);font-variant-numeric:tabular-nums;}
.zoom-panel input[type=range]{display:block;width:100%;height:1.5em;margin:0;cursor:pointer;
  accent-color:var(--pri);background:transparent;}
.zoom-panel .zp-foot{display:flex;gap:.42em;margin-top:.5em;}
.zoom-panel .zp-foot button{font-size:max(13px,.58em);font-weight:700;color:var(--pri);background:#fff;
  border:1px solid var(--rule);border-radius:5px;padding:.5em .2em;cursor:pointer;line-height:1;
  min-width:2.4em;-webkit-tap-highlight-color:transparent;
  transition:background .14s,color .14s,border-color .14s;}
.zoom-panel .zp-foot button:hover{background:var(--pri);color:#fff;border-color:var(--pri);}
.zoom-panel #zoomReset{flex:1 1 auto;font-weight:600;letter-spacing:.04em;}

/* ---------- 打印：每页一题 ----------
   注意：这是「手按 Cmd+P」时的兜底版式（A4 重排）。
   点「打印·存为PDF（矢量）」按钮时会注入另一套 @media print 把它整体压住，
   走「屏幕同款 + 逐页精确纸张尺寸」的路线。 */
@media print{
  @page{size:A4;margin:16mm 15mm;}
  body{overflow:visible;background:#fff;font-size:11.5pt;line-height:1.95;}
  .nav,.hwbar,#ink{display:none!important;}
  .slide{display:flex!important;position:static;overflow:visible;padding:0;
    animation:none!important;break-after:page;page-break-after:always;}
  /* 用 :last-of-type —— 最后一个 <section> 才是末页（body 末尾还有 script） */
  .slide:last-of-type{break-after:auto;page-break-after:auto;}
  .sinner{margin:0;max-width:none;}
  .sinner.qpage{display:block;min-height:0;}
  .cover h1{font-size:16pt;}
  .cover .dash{margin:.5em auto 1em;}
}
`;

function questionHTML(q) {
  let h = '<div class="q">\n';
  q.blocks.forEach((b, bi) => { h += blockToHTML(b, bi === 0) + '\n'; });
  const a = q.ans;
  if (a && a.steps && a.steps.length) {
    h += '<div class="ans"><button class="abtn" type="button" onclick="tg(this)"><span class="mk">▸</span>答案与解析</button><div class="abody">';
    for (const st of a.steps) {
      h += `<div class="astep${st.display ? ' dis' : ''}">` +
           (st.label ? `<span class="lb">${esc(st.label)}</span>` : '') +
           `<span class="ab">${fragsToHTML(st.frags, st.display)}</span></div>`;
    }
    h += '</div></div>\n';
  }
  return h + '</div>\n';
}

const HW_MARKUP = `<canvas id="ink"></canvas>
<div class="hwbar">
  <button id="tPrint" type="button" title="点开后在打印对话框里把目标选成「存储为 PDF」（手写批注会一起导出）">打印/存PDF（矢量）</button>
  <button id="hwtg" type="button">✎ 手写</button>
  <span id="hwtools">
    <button id="tPen" type="button" class="on">黑笔</button>
    <button id="tRed" type="button">红笔</button>
    <button id="tEr" type="button">橡皮</button>
    <button id="tClear" type="button">清本页</button>
    <button id="tAll" type="button">清全部</button>
  </span>
</div>
`;

function hwScript(pfSrc) {
  const open = '<' + 'script>';
  const close = '</' + 'script>';
  return `${open}window.pf=(function(){var exports={};${pfSrc};return exports;})();${close}
${open}
(function(){
var pf=window.pf;if(!pf||!pf.getStroke)return;
var cv=document.getElementById('ink');if(!cv)return;
var ctx=cv.getContext('2d');
var dpr=Math.min(2,window.devicePixelRatio||1);
var pages={};var cur=0;var stroking=null;
var tool='pen',penColor='#1c1c1e',penSize=4.2,eraserSize=18,busy=false;
function resize(){
  dpr=Math.min(2,window.devicePixelRatio||1);   // 换到不同缩放比的显示器后要重算
  cv.width=Math.round(innerWidth*dpr);cv.height=Math.round(innerHeight*dpr);
  cv.style.width=innerWidth+'px';cv.style.height=innerHeight+'px';redraw();
}
window.addEventListener('resize',resize);
/* 采点降密：手写笔 240Hz 的点大量挤在一起，全存只会让轮廓计算和文件体积一起膨胀。
   间距小于阈值就丢掉（视觉上无差别），抬笔那一点在 end() 里强制补上。 */
function addPoint(p){
  var pts=stroking.points,lp=pts[pts.length-1];
  var gap=(tool==='eraser')?2.2:1.3;
  if(lp){var dx=p[0]-lp[0],dy=p[1]-lp[1];if(dx*dx+dy*dy<gap*gap)return;}
  pts.push(p);
}
/* ---------- 渲染：静态层 + 活动笔画两层 ----------
   旧实现每帧把所有笔迹重填一遍，一节课写满后 iPad 上越写越卡
   （手指采点少、笔迹简单，所以同一时刻用手的反而不卡）。
   现在把"已写完的"烘进离屏层，每帧只 blit + 补画正在写的那一笔。
   缓存失效只有四种情况：换页 / 笔数变化 / 滚动 / 尺寸变化。 */
var stCv=document.createElement('canvas');
var stx=stCv.getContext('2d');
var stKey='';
function bakeStatic(list,upto){
  stCv.width=cv.width;stCv.height=cv.height;      // 改尺寸即清空
  stx.setTransform(dpr,0,0,dpr,0,0);
  drawStrokes(stx,upto===undefined?list:list.slice(0,upto),-scrollTopNow());
}
function staticKey(n){
  return cur+'|'+n+'|'+Math.round(scrollTopNow())+'|'+cv.width+'x'+cv.height;
}
function redraw(){
  var list=pages[cur]||[];
  var n=stroking?list.length-1:list.length;         // 活动笔画不进静态层
  var k=staticKey(n);
  if(k!==stKey){bakeStatic(list,n);stKey=k;}
  ctx.setTransform(1,0,0,1,0,0);
  ctx.clearRect(0,0,cv.width,cv.height);
  ctx.drawImage(stCv,0,0);
  if(stroking){
    ctx.setTransform(dpr,0,0,dpr,0,-scrollTopNow()*dpr);
    drawStrokes(ctx,[stroking],0);
  }
  ctx.setTransform(dpr,0,0,dpr,0,0);
  ctx.globalCompositeOperation='source-over';
}
/* 一帧只重画一次：iOS 一帧内可能连发多个 pointermove */
var drawQ=false;
function requestDraw(){
  if(drawQ)return;
  drawQ=true;
  requestAnimationFrame(function(){drawQ=false;redraw();});
}
/* 笔迹用「页面内容坐标」存储：y = clientY + 当前页 scrollTop。
   这样内容上下滚动时笔迹跟着一起走，而不是钉在屏幕上不动。
   （Path2D 带缓存，滚动重绘不重复算轮廓） */
/* 取当前页元素：优先认 .on 类。导出时其余页会被临时摘出 DOM，
   那时按下标取会错位，认 .on 才稳。 */
/* 当前页元素带缓存：pt() 每个采样点都要取它，原来每次都 querySelector 全文档扫描 */
var curSlide=null;
function curEl(){
  var el=curSlide;
  if(el&&el.classList&&el.classList.contains('on'))return el;
  el=document.querySelector('.slide.on')||document.querySelectorAll('.slide')[cur]||null;
  curSlide=el;return el;
}
function scrollTopNow(){var el=curEl();return el?el.scrollTop:0;}
/* 轮廓只算一次，canvas 与 SVG 两条渲染路径共用 */
function outlineOf(s){
  var n=s.points.length;
  if(s._o&&s._n===n)return s._o;
  s._o=pf.getStroke(s.points,{size:s.size,thinning:.55,smoothing:.55,streamline:.45,easing:function(t){return t},start:{taper:0},end:{taper:0}});
  s._n=n;return s._o;
}
function strokePath(s){
  var n=s.points.length;
  if(s._p&&s._n===n)return s._p;
  var o=outlineOf(s);
  if(!o||!o.length){s._p=null;return null;}
  var p=new Path2D();p.moveTo(o[0][0],o[0][1]);
  for(var i=1;i<o.length;i++)p.lineTo(o[i][0],o[i][1]);
  p.closePath();s._p=p;
  s._o=null;    // 轮廓数组是单笔占用最大的一块；构完 Path2D 就放掉，打印时按需重算
  return p;
}
function drawStrokes(x,strokes,dy){
  x.save();
  if(dy)x.translate(0,dy);
  for(var i=0;i<strokes.length;i++){
    var s=strokes[i],p=strokePath(s);
    if(!p)continue;
    if(s.tool==='eraser'){x.globalCompositeOperation='destination-out';x.fillStyle='#000';x.fill(p);x.globalCompositeOperation='source-over';}
    else{x.fillStyle=s.color;x.fill(p);}
  }
  x.restore();
}
/* 滚动时笔迹跟着内容重绘（rAF 节流） */
var rafId=0;
document.addEventListener('scroll',function(){
  if(rafId||busy)return;
  rafId=requestAnimationFrame(function(){rafId=0;redraw();});
},true);
/* ---------- 内存：Path2D/轮廓缓存只保留当前页 ----------
   点数据是唯一事实来源，两者都只是缓存。一节课写满后 19 页的缓存能堆到近百 MB，
   iPad 上会被系统杀掉后台。离开某页就丢掉它的缓存，回来按需重算
   （一次性 O(该页墨量)，翻页本来就是低频动作）。 */
function dropCaches(){
  for(var k in pages){
    var list=pages[k];
    if(!list)continue;
    for(var j=0;j<list.length;j++){list[j]._p=null;list[j]._o=null;list[j]._n=-1;list[j]._d=undefined;}
  }
}
/* 内容缩放（右上角 Aa 滑块）后，笔迹坐标跟着等比换算，
   否则放大过的页面里原来的批注会「漂」到别处。 */
window.__inkRescale=function(ratio){
  if(!ratio||ratio===1)return;
  for(var k in pages){
    var list=pages[k]||[];
    for(var i=0;i<list.length;i++){
      var pts=list[i].points;
      for(var j=0;j<pts.length;j++){pts[j][0]*=ratio;pts[j][1]*=ratio;}
      list[i]._p=null;list[i]._o=null;list[i]._n=-1;list[i]._d=undefined;list[i]._dn=undefined;
    }
  }
  stKey='';redraw();
};
/* 手写层挂在翻页回调上。必须链式保留已有的 __onPage——
   直接赋值会把练习页/插件先挂的钩子覆盖掉（2026-10-19 踩过）。 */
(function(){
  var old=window.__onPage;
  window.__onPage=function(i){
    cur=i;curSlide=null;
    dropCaches();
    redraw();
    if(old)old(i);
  };
})();
function pt(e){return [e.clientX,e.clientY+scrollTopNow(),Math.max(.08,e.pressure||.5)];}
/* 手写模式下触屏单指写字、双指上下拖动翻内容（否则开着书写就没法滚动） */
/* ---------- 指针处理：Apple Pencil 友好 ----------
   四条 iPad 上踩过的坑，都在这里处理：
   ① 手掌/手指先压屏再落笔 → 旧逻辑把「第二支指针」当双指拖动，笔一落就被取消 → 掌拒
   ② 手掌一直压着乱动 → 旧逻辑任何指针的 move 都往当前笔画里塞点 → 笔画被拉花
   ③ 写快了丢笔 → iOS 把一帧内的多个采样合并成一个 pointermove，要靠 getCoalescedEvents 取回
   ④ 快速书写划到边缘 → 旧逻辑监听 pointerleave 直接结束笔画（有 pointer capture 其实不需要） */
var active={},panning=null,strokePid=null,pens={};
function cancelStroke(){
  if(!stroking)return;
  var arr=pages[cur]||[],i=arr.indexOf(stroking);
  if(i>=0)arr.splice(i,1);
  stroking=null;strokePid=null;redraw();
}
function beginStroke(e){
  strokePid=e.pointerId;
  try{cv.setPointerCapture(e.pointerId);}catch(_){}
  stroking={tool:tool,color:tool==='red'?'#c0392b':penColor,size:(tool==='eraser'?eraserSize:penSize),points:[pt(e)]};
  (pages[cur]=pages[cur]||[]).push(stroking);
  redraw();
}
cv.addEventListener('pointerdown',function(e){
  if(!document.body.classList.contains('hw'))return;
  e.preventDefault();
  if(e.pointerType==='pen'){
    pens[e.pointerId]=1;panning=null;               // 笔尖落纸：接管一切
    if(stroking&&strokePid!==e.pointerId)cancelStroke();  // 手掌刚才误起的那一笔作废
    beginStroke(e);
    return;
  }
  if(Object.keys(pens).length)return;               // 笔在写：手指、手掌一律不响应（掌拒）
  active[e.pointerId]={y:e.clientY};
  if(Object.keys(active).length>1){                  // 两根以上手指 → 拖动内容
    cancelStroke();
    panning={y:e.clientY,top:scrollTopNow()};
    return;
  }
  beginStroke(e);
});
cv.addEventListener('pointermove',function(e){
  if(active[e.pointerId])active[e.pointerId].y=e.clientY;
  if(panning){
    if(e.pointerType==='pen')return;
    e.preventDefault();
    var el=curEl();if(el)el.scrollTop=panning.top-(e.clientY-panning.y);
    return;
  }
  if(!stroking||e.pointerId!==strokePid)return;      // 只认正在书写的那一支
  e.preventDefault();
  var evs=null;
  try{evs=e.getCoalescedEvents?e.getCoalescedEvents():null;}catch(_){evs=null;}
  if(evs&&evs.length){                               // 一帧内的多个采样全部取回，写快也不断
    for(var i=0;i<evs.length;i++)addPoint(pt(evs[i]));
  }else{
    addPoint(pt(e));
  }
  requestDraw();
});
function end(e){
  var pid=(e&&e.pointerId!=null)?e.pointerId:null;
  var mine=(pid!=null&&pid===strokePid&&!!stroking);
  if(mine&&e&&e.clientX!=null){
    var p=pt(e),pts=stroking.points,lp=pts[pts.length-1];   // 收笔那一点必须留下
    if(!lp||Math.abs(p[0]-lp[0])>0.4||Math.abs(p[1]-lp[1])>0.4)pts.push(p);
  }
  if(pid!=null){delete active[pid];delete pens[pid];}
  if(Object.keys(active).length<2)panning=null;
  if(mine){
    /* 收笔：只把这一笔补进静态层，绝不整页重烘
       （整页重烘是 O(已有墨量)，抬一次笔一次，iPad 上就是"每写完一笔卡一下"） */
    var fin=stroking;
    stroking=null;strokePid=null;
    try{
      stx.setTransform(dpr,0,0,dpr,0,0);
      drawStrokes(stx,[fin],-scrollTopNow());
      stKey=staticKey(pages[cur]||[]);
    }catch(_){stKey='';}
    redraw();
    return;
  }
  if(!Object.keys(active).length&&!Object.keys(pens).length){stroking=null;strokePid=null;}
  requestDraw();
}
cv.addEventListener('pointerup',end);
cv.addEventListener('pointercancel',end);
/* 不监听 pointerleave：有 pointer capture，快速书写划出边缘会误结束笔画 */
/* iOS 兜底：不让触摸被当成滚动手势，否则浏览器会掐断 pointer 流 */
['touchstart','touchmove'].forEach(function(t){
  cv.addEventListener(t,function(e){if(document.body.classList.contains('hw'))e.preventDefault();},{passive:false});
});
var tg=document.getElementById('hwtg');
var tPen=document.getElementById('tPen'),tRed=document.getElementById('tRed'),tEr=document.getElementById('tEr');
if(tg){tg.onclick=function(){
  var on=document.body.classList.toggle('hw');
  var tl=document.getElementById('hwtools');
  if(tl)tl.classList.toggle('show',on);
  tg.textContent=on?'✔ 结束书写':'✎ 手写';
  if(on&&window.getSelection){try{window.getSelection().removeAllRanges();}catch(_){}}  // 进手写前清掉已有选区
  pens={};strokePid=null;panning=null;   // 进/出手写都重置笔状态，避免漏 pointerup 卡住
  syncBar();
  redraw();
};}
/* 手写模式屏蔽「长按选中 / 右键菜单 / 拖拽文字」：
   iPad、Surface 上长按会弹「拷贝·查询·翻译」并中断正在写的笔画，这里统一拦掉。 */
function noSel(e){if(document.body.classList.contains('hw'))e.preventDefault();}
document.addEventListener('selectstart',noSel,false);
document.addEventListener('contextmenu',noSel,false);
document.addEventListener('dragstart',noSel,false);
function mark(btn){[tPen,tRed,tEr].forEach(function(b){if(b)b.classList.toggle('on',b===btn);});}
/* 橡皮三档：点橡皮进橡皮模式；已在橡皮模式时再点循环 细→中→粗。
   每笔的擦除尺寸随笔画记录（s.size），换档不会让旧笔迹重算变形。 */
var ER=[14,26,44],ERN=['细','中','粗'],erIdx=1;
function applyEr(){
  eraserSize=ER[erIdx];
  if(tEr){tEr.textContent='橡皮·'+ERN[erIdx];tEr.title='橡皮（当前'+ERN[erIdx]+'）：已在橡皮模式时再点一下切换粗细';}
}
applyEr();
if(tPen)tPen.onclick=function(){tool='pen';mark(this);};
if(tRed)tRed.onclick=function(){tool='red';mark(this);};
if(tEr)tEr.onclick=function(){
  if(tool!=='eraser'){tool='eraser';mark(this);return;}
  erIdx=(erIdx+1)%ER.length;applyEr();
};
var tC=document.getElementById('tClear');if(tC)tC.onclick=function(){pages[cur]=[];redraw();};
var tA=document.getElementById('tAll');if(tA)tA.onclick=function(){pages={};redraw();};

/* ---------- 底部留白随工具栏实测高度自适应 ----------
   工具栏在窄屏/展开二级菜单时会折行变高，
   这里把它的真实高度写进 --barh，.slide 据此预留底部空间，
   保证任何情况下最后一行内容都能滑到工具栏上方，不被遮挡。 */
var bar=document.querySelector('.hwbar');
function syncBar(){
  if(!bar||busy)return;
  var r=bar.getBoundingClientRect();
  var need=Math.ceil(r.height+(innerHeight-r.bottom)+16);
  document.documentElement.style.setProperty('--barh',need+'px');
  /* 工具栏宽度按「右下角翻页区」的实际位置收窄，按钮多了也不会撞上去 */
  var nav=document.querySelector('.nav');
  if(nav){
    var avail=Math.floor(nav.getBoundingClientRect().left-r.left-12);
    bar.style.maxWidth=Math.max(150,avail)+'px';
  }
}
window.__syncBar=syncBar;
syncBar();
if(window.ResizeObserver){try{new ResizeObserver(function(){syncBar();}).observe(bar);}catch(_){}}
window.addEventListener('resize',function(){syncBar();});
window.addEventListener('orientationchange',function(){syncBar();});
setTimeout(function(){syncBar();},350);

/* ---------- 导出 PDF：直接交给浏览器原生打印管线 ----------
   整章 19 页约 0.4 秒 / 400KB，纯矢量（文字可选中、放大不糊），手写批注也能带进去。
   做法：临时注入一份打印样式，把版式冻结成「屏幕同款」——
   ① 每页用 CSS 命名页 @page 单独指定纸张尺寸（逐页精确贴合，不裁切也不留白边）；
   ② .slide 从 fixed 改成 static、宽高与屏幕完全一致，这样手写批注的位置能对上；
   ③ print-color-adjust:exact 强制打印背景色（否则答案框底色会被打印选项吃掉）；
   ④ 笔迹转成 SVG path 贴进每一页（橡皮用 mask 挖空）。
   用户在打印对话框里选「存储为 PDF」即可。 */
function svgOutline(s){
  var n=s.points.length;
  if(s._d!==undefined&&s._dn===n)return s._d;
  var o=outlineOf(s);
  var d='';
  if(o&&o.length){
    d='M'+o[0][0].toFixed(1)+' '+o[0][1].toFixed(1);
    for(var i=1;i<o.length;i++)d+='L'+o[i][0].toFixed(1)+' '+o[i][1].toFixed(1);
    d+='Z';
  }
  s._d=d;s._dn=n;return d;
}
var SVGNS='http://www.w3.org/2000/svg';
function preparePrint(){
  /* 幂等：先清掉上一次可能残留的产物（例如上次清理回调没触发时又点了按钮），
     否则会叠加两份样式和两份笔迹 SVG。 */
  /* 打印固定按 100% 输出：临时复位内容缩放（--z），并把笔迹坐标还原到 100% 尺度，
     打印结束（cleanup）再原样恢复，导出的 PDF 版面与屏幕上「未放大」时一致。 */
  var rootEl=document.documentElement;
  var zRaw=parseFloat(rootEl.style.getPropertyValue('--z'));
  if(!isFinite(zRaw)||zRaw<=0)zRaw=1;
  if(zRaw!==1){
    rootEl.style.setProperty('--z','1');
    if(window.__inkRescale)window.__inkRescale(1/zRaw);
  }
  var stale=document.getElementById('printSheet');
  if(stale)stale.parentNode.removeChild(stale);
  var staleSvg=document.querySelectorAll('svg.inkprint');
  for(var q=0;q<staleSvg.length;q++)staleSvg[q].parentNode.removeChild(staleSvg[q]);
  var all=[].slice.call(document.querySelectorAll('.slide'));
  for(var q=0;q<all.length;q++){
    var cl=all[q].classList,kill=[];
    for(var j=0;j<cl.length;j++)if(cl[j].indexOf('pgi')===0)kill.push(cl[j]);
    for(j=0;j<kill.length;j++)cl.remove(kill[j]);
  }
  var vw=Math.round(innerWidth);
  busy=true;   // 量高度要反复切 .on，期间屏蔽滚动重绘和工具栏测量
  var keepOn=-1;
  for(var i=0;i<all.length;i++)if(all[i].classList.contains('on'))keepOn=i;
  if(keepOn<0){keepOn=0;all[0].classList.add('on');}
  // 量版面用的基准样式从「可见的那一页」读——display:none 的元素读到的是计算值，
  // 万一以后 padding 用了百分比之类依赖布局的单位就会读错。
  var base=getComputedStyle(all[keepOn]);
  var bodyCS=getComputedStyle(document.body);
  // 逐页量「这一页实际需要多高」（切到 .on 才量得到）
  var hs=[],prev=keepOn;
  for(i=0;i<all.length;i++){
    if(prev!==i)all[prev].classList.remove('on');
    all[i].classList.add('on');
    hs.push(Math.max(all[i].clientHeight,all[i].scrollHeight));
    prev=i;
  }
  all[prev].classList.remove('on');
  all[keepOn].classList.add('on');
  // 组装打印样式 + 笔迹 SVG
  var css='@page{size:'+vw+'px '+Math.round(innerHeight)+'px;margin:0;}';
  var added=[];
  for(i=0;i<all.length;i++){
    var cn='pgi'+i,h=hs[i],maskId='pmk'+i;
    all[i].classList.add(cn);added.push(cn);
    css+='@page '+cn+'{size:'+vw+'px '+h+'px;margin:0;}'
       + '.slide.'+cn+'{page:'+cn+';height:'+h+'px!important;min-height:0!important;overflow:hidden!important;}';
    var st=pages[i]||[];
    if(!st.length)continue;
    var pens=[],eras=[],defs='';
    for(var j=0;j<st.length;j++){
      var d=svgOutline(st[j]);if(!d)continue;
      var p=document.createElementNS(SVGNS,'path');
      p.setAttribute('d',d);
      if(st[j].tool==='eraser'){p.setAttribute('fill','#000');eras.push(p);}
      else{p.setAttribute('fill',st[j].color);pens.push(p);}
    }
    if(!pens.length&&!eras.length)continue;
    var svg=document.createElementNS(SVGNS,'svg');
    svg.setAttribute('class','inkprint');
    svg.setAttribute('viewBox','0 0 '+vw+' '+h);
    svg.setAttribute('preserveAspectRatio','none');
    svg.style.cssText='position:absolute;left:0;top:0;width:'+vw+'px;height:'+h+'px;pointer-events:none';
    if(eras.length){                       // 橡皮：用 mask 把笔迹挖空（同一页的擦除统一作用）
      defs=document.createElementNS(SVGNS,'defs');
      var mk=document.createElementNS(SVGNS,'mask');
      mk.setAttribute('id',maskId);mk.setAttribute('maskUnits','userSpaceOnUse');
      mk.setAttribute('x','0');mk.setAttribute('y','0');
      mk.setAttribute('width',vw);mk.setAttribute('height',h);
      var r=document.createElementNS(SVGNS,'rect');
      r.setAttribute('x','0');r.setAttribute('y','0');
      r.setAttribute('width',vw);r.setAttribute('height',h);
      r.setAttribute('fill','#fff');
      mk.appendChild(r);
      eras.forEach(function(e){mk.appendChild(e);});
      defs.appendChild(mk);svg.appendChild(defs);
      var g=document.createElementNS(SVGNS,'g');
      g.setAttribute('mask','url(#'+maskId+')');
      pens.forEach(function(e){g.appendChild(e);});
      svg.appendChild(g);
    }else{
      pens.forEach(function(e){svg.appendChild(e);});
    }
    all[i].appendChild(svg);
  }
  /* 所有规则都加 html 前缀提高优先级——样表里另有一套 @media print（手按 Cmd+P 用的
     A4 重排版式），它会改写字号和 .sinner 布局，必须整体压住才能保证「所见即所得」。 */
  /* 行高必须用「无单位倍数」还原：body 的 line-height:1.9 是倍率，
     若写成固定像素往下继承，小字号的眉题/小标签会拿到过大的行高，整页被撑开。 */
  var lhNum=parseFloat(bodyCS.lineHeight)/parseFloat(bodyCS.fontSize);
  if(!isFinite(lhNum)||lhNum<=0)lhNum=1.9;
  css+='@media print{'
    +'html,html body{overflow:visible!important;background:#fff!important;font-size:'+bodyCS.fontSize+'!important;line-height:'+lhNum.toFixed(3)+'!important;}'
    +'html *,html *::before,html *::after{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;}'
    +'html .nav,html .hwbar,html #ink,html .tmr,html .tmr-menu,html .zoom-panel{display:none!important;}'
    +'html .slide{display:block!important;position:relative!important;top:auto!important;left:auto!important;right:auto!important;bottom:auto!important;'
      +'width:'+vw+'px!important;margin:0!important;animation:none!important;transition:none!important;'
      +'padding:'+base.paddingTop+' '+base.paddingRight+' '+base.paddingBottom+' '+base.paddingLeft+'!important;'
      +'break-after:page!important;page-break-after:always!important;}'
    +'html .slide:last-of-type{break-after:auto!important;page-break-after:auto!important;}'
    +'html .sinner{margin:0 auto!important;max-width:46em!important;}'
    +'html .sinner.qpage{display:flex!important;flex-direction:column!important;min-height:100%!important;justify-content:flex-start!important;}'
    +'html .sinner.qpage>*{flex:0 0 auto!important;}'
    +'html .sinner.qpage.two .q:last-child{margin-top:auto!important;margin-bottom:auto!important;}'
    +'html .sinner.cover{margin:0 auto!important;padding-top:'+getComputedStyle(all[0].querySelector('.sinner')).paddingTop+'!important;}'
    +'html .cover h1{font-size:1.5em!important;}'
    +'html .cover .dash{margin:.7em auto 1.4em!important;}'
    +'html .inkprint{display:block!important;}'
    +'}';
  var style=document.createElement('style');
  style.id='printSheet';style.setAttribute('media','print');style.textContent=css;
  document.head.appendChild(style);
  busy=false;
  return function cleanup(){
    var s2=document.getElementById('printSheet');if(s2)s2.parentNode.removeChild(s2);
    for(var k=0;k<added.length;k++)all[k].classList.remove(added[k]);
    var svgs=document.querySelectorAll('svg.inkprint');
    for(k=0;k<svgs.length;k++)svgs[k].parentNode.removeChild(svgs[k]);
    if(zRaw!==1){
      rootEl.style.setProperty('--z',zRaw.toFixed(2));
      if(window.__inkRescale)window.__inkRescale(zRaw);
    }
  };
}
/* 供自动化自检调用（与 l2html 对齐） */
window.__preparePrint=preparePrint;
var tP=document.getElementById('tPrint');
if(tP)tP.onclick=function(){
  var cleanup=preparePrint(),done=false;
  function fin(){if(done)return;done=true;cleanup();window.removeEventListener('afterprint',fin);}
  window.addEventListener('afterprint',fin);
  setTimeout(function(){window.print();},80);
};
resize();
})();
${close}
${open}
/* ---------- 倒计时：1/3/5/10 分钟档位 ----------
   点右上角 ⏱ 选时长 → 按钮变成剩余时间（运行中再点=暂停，✕=取消）；
   归零后全屏动画 + 三声提示音，10 秒后或点击任意处关闭。
   用 Date.now() 累计，不吃 setInterval 漂移；跨页翻动不重置。 */
(function(){
var btn=document.getElementById('tmrBtn'),txt=document.getElementById('tmrTxt'),
    menu=document.getElementById('tmrMenu'),box=document.getElementById('tmr'),
    cx=document.getElementById('tmrCancel'),over=document.getElementById('tmrOver'),
    sub=document.getElementById('tmrSub');
if(!btn||!over)return;
var total=0,left=0,tick=null,last=0,running=false,auto=null;
function fmt(s){s=Math.max(0,Math.round(s));var m=Math.floor(s/60),r=s%60;return (m<10?'0':'')+m+':'+(r<10?'0':'')+r;}
function paint(){
  txt.textContent=total?fmt(left):'计时';
  box.classList.toggle('run',!!total&&running);
  box.classList.toggle('pause',!!total&&!running);
  box.classList.toggle('warn',!!total&&left<=60&&left>0);
}
function stopTick(){if(tick){clearInterval(tick);tick=null;}}
function start(){
  stopTick();running=true;last=Date.now();
  tick=setInterval(function(){
    var now=Date.now();left-=(now-last)/1000;last=now;
    if(left<=0){left=0;paint();finish();return;}
    paint();
  },200);
  paint();
}
function pause(){stopTick();running=false;paint();}
function cancel(){stopTick();running=false;total=0;left=0;paint();hide();menu.classList.remove('show');}
function hide(){over.classList.remove('on');over.onclick=null;if(auto){clearTimeout(auto);auto=null;}}
function finish(){
  stopTick();running=false;
  var used=fmt(total);
  total=0;left=0;paint();          // 归零后回到空闲态：再点按钮是选新时长，而不是立刻又响一次
  over.classList.add('on');
  sub.textContent='本次计时 '+used+' · 点击任意处关闭';
  beep();
  auto=setTimeout(hide,10000);
  over.onclick=hide;
}
function choose(min){total=left=min*60;menu.classList.remove('show');start();}
function beep(){
  if(window.Q2H_MUTED)return;                 // 小插件「静音」会置这个
  try{
    var C=window.AudioContext||window.webkitAudioContext;if(!C)return;
    var ac=new C();
    [0,.2,.4].forEach(function(t){
      var o=ac.createOscillator(),g=ac.createGain();
      o.type='sine';o.frequency.value=880;
      g.gain.setValueAtTime(0,ac.currentTime+t);
      g.gain.linearRampToValueAtTime(.22,ac.currentTime+t+.02);
      g.gain.linearRampToValueAtTime(0,ac.currentTime+t+.14);
      o.connect(g);g.connect(ac.destination);
      o.start(ac.currentTime+t);o.stop(ac.currentTime+t+.16);
    });
    setTimeout(function(){try{ac.close();}catch(_){}} ,1400);
  }catch(_){}
}
btn.addEventListener('click',function(e){
  e.stopPropagation();
  if(!total){menu.classList.toggle('show');return;}
  running?pause():start();
});
cx.addEventListener('click',function(e){e.stopPropagation();cancel();});
menu.addEventListener('click',function(e){
  var b=e.target;while(b&&b!==menu&&!(b.getAttribute&&b.getAttribute('data-min')))b=b.parentNode;
  if(b&&b.getAttribute&&b.getAttribute('data-min'))choose(parseInt(b.getAttribute('data-min'),10));
});
document.addEventListener('click',function(){menu.classList.remove('show');});
document.addEventListener('keydown',function(e){if(e.key==='Escape'){hide();menu.classList.remove('show');}});
paint();
})();
${close}`;
}

/* ================= 组装成一个 HTML ================= */
const WIDGET_CSS = '/* ================= 课堂小插件（可多选，body 上加 w-xxx 开启） ================= */\n/* --- 顶部细进度条（pace） --- */\n.wpace{position:fixed;top:0;left:0;height:3px;background:var(--acc);z-index:58;\n  width:0;transition:width .35s ease;box-shadow:0 0 6px rgba(184,85,47,.5);}\n/* --- 进度植物（plant）---\n   放右下角、「下一页」按键上面：那一带是翻页区的留白，不占内容空间。\n   想要左上角用 plant-tl。 */\n.wplant{position:fixed;right:clamp(14px,3vmin,36px);\n  bottom:calc(var(--pad-y) + 6vh + 46px);z-index:57;\n  display:flex;flex-direction:row-reverse;align-items:flex-end;gap:.5em;pointer-events:none;}\n.wplant svg{width:56px;height:62px;overflow:visible;flex:0 0 auto;}\n.wp-num{font-family:"PingFang SC","Microsoft YaHei",sans-serif;font-size:11px;color:#8a857c;\n  font-variant-numeric:tabular-nums;padding-bottom:1.1em;letter-spacing:.04em;}\n.wplant .stem{transform:scaleY(0);transform-origin:32px 50px;\n  transition:transform .55s cubic-bezier(.2,1.5,.4,1);}\n.wplant .leaf,.wplant .bloom,.wplant .seed{opacity:0;transition:opacity .45s;}\n.wplant .seed{opacity:1;transition:opacity .3s;}\n.wplant.s1 .stem{transform:scaleY(.24);}\n.wplant.s2 .stem{transform:scaleY(.48);}\n.wplant.s3 .stem,.wplant.s4 .stem,.wplant.s5 .stem{transform:scaleY(1);}\n.wplant.s2 .l1{opacity:1;}\n.wplant.s3 .l1,.wplant.s4 .l1,.wplant.s5 .l1{opacity:1;}\n.wplant.s4 .l2,.wplant.s5 .l2{opacity:1;}\n.wplant.s5 .seed{opacity:0;}\n.wplant.s5 .bloom{opacity:1;animation:bloomIn .7s cubic-bezier(.2,1.7,.4,1) both;}\n@keyframes bloomIn{0%{transform:scale(.2);opacity:0}70%{transform:scale(1.15)}100%{transform:scale(1);opacity:1}}\n/* 左上角变体 */\nbody.w-plant-tl .wplant{bottom:auto;top:calc(8px + env(safe-area-inset-top));\n  left:clamp(8px,2vmin,20px);right:auto;flex-direction:row;}\nbody.w-plant-tl .wp-num{padding-bottom:0;position:absolute;top:60px;left:0;width:56px;text-align:center;}\nbody.w-plant-tl .slide{padding-top:calc(var(--pad-y) + 8px + 58px);}\n/* --- 专注模式（focus）：按"题"聚焦 ---\n   开启后本页所有题压暗；点某道题 → 这道题整体变亮（不是只亮一行）；\n   未开启时全部保持全亮。 */\nbody.focus-on .slide.on .q{opacity:.16;transition:opacity .3s;}\nbody.focus-on .slide.on .q.fc{opacity:1;}\n/* --- 活动提醒（nudge） --- */\n.nudge-toast{position:fixed;left:50%;top:16%;transform:translateX(-50%);z-index:115;\n  display:none;gap:.9em;align-items:center;max-width:min(560px,92vw);padding:.7em 1.1em;\n  border-radius:12px;background:#fff;border:1px solid var(--rule);\n  box-shadow:0 12px 34px -12px rgba(0,0,0,.32);\n  font-family:"PingFang SC","Microsoft YaHei",sans-serif;font-size:max(13px,.58em);color:#333;}\n.nudge-toast.on{display:flex;animation:qzIn .3s cubic-bezier(.2,1.5,.4,1) both;}\n.nudge-toast .nt-t{font-weight:600;color:var(--pri);}\n.nudge-toast button{font:inherit;font-weight:600;border-radius:6px;padding:.4em .85em;cursor:pointer;\n  border:1px solid var(--rule);background:#fff;color:var(--pri);}\n.nudge-toast button.pri{background:var(--pri);color:#fff;border-color:var(--pri);}\n@keyframes qzIn{from{transform:translateX(-50%) scale(.7);opacity:0}to{transform:translateX(-50%) scale(1);opacity:1}}\n/* --- 随机抽问（roll）：抽学号不抽名，减少尴尬 --- */\n.roll-over{position:fixed;inset:0;z-index:210;display:none;flex-direction:column;\n  align-items:center;justify-content:center;overflow:hidden;\n  background:radial-gradient(circle at center,rgba(31,58,95,.96),rgba(20,32,52,.99));}\n.roll-over.on{display:flex;animation:ovIn .25s ease both;}\n.roll-num{font-family:"PingFang SC","Microsoft YaHei",sans-serif;font-weight:800;color:#fff;\n  font-size:clamp(84px,24vmin,240px);line-height:1;font-variant-numeric:tabular-nums;\n  text-shadow:0 10px 50px rgba(0,0,0,.45);}\n.roll-cap{margin-top:1.1em;color:rgba(255,255,255,.86);font-family:"PingFang SC","Microsoft YaHei",sans-serif;\n  font-size:clamp(14px,2.6vmin,24px);letter-spacing:.16em;font-weight:600;}\n.roll-bar{margin-top:1.7em;display:flex;gap:.7em;}\n.roll-bar button{font:inherit;font-weight:600;font-size:max(13px,.6em);padding:.55em 1.2em;border-radius:8px;\n  border:1px solid rgba(255,255,255,.42);background:transparent;color:#fff;cursor:pointer;}\n.roll-bar button.pri{background:#fff;color:var(--pri);border-color:#fff;}\n.roll-set{position:absolute;top:16px;right:16px;display:flex;gap:.45em;align-items:center;\n  color:rgba(255,255,255,.72);font-family:"PingFang SC",sans-serif;font-size:12px;}\n.roll-set input{width:54px;font:inherit;padding:.32em .5em;border-radius:6px;\n  border:1px solid rgba(255,255,255,.35);background:rgba(255,255,255,.14);color:#fff;text-align:center;}\n/* --- 举手统计（vote）：老师扫一眼点一下，形成性评价 --- */\n.vote-panel{position:fixed;left:50%;bottom:calc(var(--barh) + 6vh + 12px);transform:translateX(-50%);\n  z-index:112;display:none;gap:.5em;padding:.5em;border-radius:14px;background:#fff;\n  border:1px solid var(--rule);box-shadow:0 10px 30px -10px rgba(0,0,0,.3);\n  font-family:"PingFang SC","Microsoft YaHei",sans-serif;}\n.vote-panel.on{display:flex;animation:qzIn .3s cubic-bezier(.2,1.5,.4,1) both;}\n.vote-panel .vp-t{display:flex;flex-direction:column;align-items:center;gap:.1em;min-width:66px;\n  font:inherit;font-size:max(12px,.55em);font-weight:600;color:var(--pri);background:#fff;\n  border:1px solid var(--rule);border-radius:10px;padding:.5em .6em;cursor:pointer;line-height:1.25;}\n.vote-panel .vp-t:hover{background:#f6f3ee;}\n.vote-panel .vp-t b{font-size:1.55em;font-variant-numeric:tabular-nums;color:var(--acc);}\n.vote-panel .vz{font:inherit;font-size:11px;color:#8a857c;background:#fff;border:1px solid var(--rule);\n  border-radius:8px;padding:.5em .6em;cursor:pointer;align-self:stretch;}\n.vote-panel .vz:hover{color:var(--acc);border-color:var(--acc);}\n/* --- 要点卡（exit）：下课前 2 分钟 --- */\n.exit-card{position:fixed;inset:0;z-index:205;display:none;align-items:center;justify-content:center;\n  background:rgba(250,248,244,.97);}\n.exit-card.on{display:flex;animation:ovIn .25s ease both;}\n.exit-in{width:min(680px,92vw);font-family:"Songti SC",serif;}\n.exit-in h2{margin:0 0 .15em;font-size:clamp(24px,4.4vmin,40px);color:var(--pri);letter-spacing:.04em;}\n.exit-in .ex-sub{font-family:"PingFang SC","Microsoft YaHei",sans-serif;font-size:max(12px,.58em);\n  color:#8a857c;margin-bottom:1em;}\n.exit-in ol{margin:0;padding-left:1.4em;}\n.exit-in li{margin:.55em 0;font-size:clamp(16px,2.6vmin,23px);line-height:1.75;}\n.exit-in li em{color:var(--acc);font-style:normal;font-weight:600;}\n.exit-foot{margin-top:1.4em;display:flex;gap:.8em;align-items:center;\n  font-family:"PingFang SC","Microsoft YaHei",sans-serif;}\n.exit-foot .ex-t{font-weight:700;font-size:1.6em;color:var(--pri);font-variant-numeric:tabular-nums;}\n.exit-foot button{font:inherit;font-weight:600;padding:.5em 1.1em;border-radius:8px;\n  border:1px solid var(--rule);background:#fff;color:var(--pri);cursor:pointer;}\n.exit-foot button.pri{background:var(--pri);color:#fff;border-color:var(--pri);}\n/* --- 小插件按钮（跟计时器同风格） --- */\n.tmr{flex-wrap:wrap;justify-content:flex-end;max-width:min(94vw,700px);row-gap:.25em;}\n.tmr .wbtn{font-size:max(12px,.54em);font-weight:600;color:var(--pri);background:#fff;\n  border:1px solid var(--rule);border-radius:5px;padding:.42em .6em;cursor:pointer;line-height:1;\n  white-space:nowrap;display:inline-flex;align-items:center;gap:.3em;\n  transition:background .16s,color .16s,border-color .16s;-webkit-tap-highlight-color:transparent;}\n.tmr .wbtn:hover{background:var(--pri);color:#fff;border-color:var(--pri);}\n.tmr .wbtn.on{background:var(--pri);color:#fff;border-color:var(--pri);}\n.tmr .wbtn .ic{font-size:1.05em;}\n/* 练习页页眉要让开顶部工具栏：工具栏是 fixed 在右上，一行约 33px 高（底边 43px）。\n   .slide 原本只给 pad-y + 8px，宽屏下（pad-y 只有 27px）页眉会被压住，这里兜一个下限。 */\n.slide-prac{padding-top:max(calc(var(--pad-y) + 8px), 56px);}\n/* 窄屏（≤860px）不再隐藏文字标签 —— 2026-10-19 改。\n   原先只留一个 16×13px 的裸 emoji，用户反馈「手机上看不到、也不知道点什么」。\n   实测计时器 + 5 个插件按钮带上文字：普通页一行放得下（约 344px / 390px 屏），\n   练习页多一个「换一批」会换行成两行（约 67px 高）。\n   所以这里做两件事：\n   ① 收紧间距 + 把点击热区抬到 32px（原来是 25px，低于拇指最小可点尺寸）；\n   ② 给练习页补顶部内边距，避开换行后加高的工具栏（否则页眉被压住）。 */\n@media (max-width:860px){\n  .tmr{gap:.15em;}\n  .tmr .tmr-btn{padding:.45em .55em;min-height:32px;}\n  .tmr .wbtn{padding:.45em .5em;min-width:32px;min-height:32px;}\n  .tmr .wbtn .ic{font-size:1.1em;}\n  .slide-prac{padding-top:calc(var(--pad-y) + 78px);}\n}\n/* 超窄屏（≤400px，如 320/360）：5 个按钮也会换行成两行（约 67px 高），\n   题目页同样要往下让，否则第一题会钻到工具栏底下。 */\n@media (max-width:400px){\n  .slide:not(.slide-prac){padding-top:calc(var(--pad-y) + 66px);}\n}\n@media print{.wpace,.wplant,.nudge-toast,.roll-over,.vote-panel,.exit-card{display:none!important;}}\n';
const WIDGET_JS = '/* ================= 课堂小插件 =================\n   plant     进度植物：随翻页生长（6 阶段）；默认右下角「下一页」上方，plant-tl 回左上角\n   pace      顶部 3px 细进度条\n   focus     专注模式：开启后本页所有题压暗，点某道题→这道题整体变亮；↑/↓ 换题，Esc 退出\n   nudge     活动提醒：每 12 分钟温和提示一次活动 ——【已停用，不在 INITS 里注册】\n   roll      随机抽问：抽学号（不抽名，减少尴尬），范围可设并记住\n   vote      举手统计：👍懂 / 🤔模糊 / ❓不懂 三键计数 ——【已停用，不在 INITS 里注册】\n   exit      要点卡：下课前 2 分钟，三条提示 + 倒计时\n   allans    本页答案全部展开 / 全部收起                                    */\n(function(){\nvar WB=document.body;\n(WB.getAttribute(\'data-widgets\')||\'\').split(\',\').forEach(function(w){\n  if(w)WB.classList.add(\'w-\'+w);\n});\nvar INITS={\n  plant:initPlant,\'plant-tl\':initPlant,pace:initPace,focus:initFocus,\n  roll:initRoll,exit:initExit,allans:initAllAns\n};\nObject.keys(INITS).forEach(function(w){\n  if(WB.classList.contains(\'w-\'+w)&&INITS[w])INITS[w]();\n});\n\n/* ---------- 公共 ---------- */\nfunction hookPage(fn){                      // 挂在翻页回调上（可叠加）\n  var old=window.__onPage;\n  window.__onPage=function(i){ if(old)old(i); fn(i); };\n}\nfunction curIdx(){\n  var all=document.querySelectorAll(\'.slide\'),i=0;\n  all.forEach(function(s,j){if(s.classList.contains(\'on\'))i=j;});\n  return {i:i,n:all.length,el:all[i]||null};\n}\nfunction mkBtn(icon,text,title){            // 统一风格的小按钮\n  var b=document.createElement(\'button\');\n  b.type=\'button\';b.className=\'wbtn\';b.title=title||text;\n  b.innerHTML=\'<span class="ic">\'+icon+\'</span><span class="tx">\'+text+\'</span>\';\n  return b;\n}\n\n/* ---------- pace：顶部进度条 ---------- */\nfunction initPace(){\n  var bar=document.createElement(\'div\');bar.className=\'wpace\';document.body.appendChild(bar);\n  function upd(){var c=curIdx();bar.style.width=(c.n>1?(c.i/(c.n-1)*100):100)+\'%\';}\n  hookPage(upd);upd();\n}\n\n/* ---------- plant：进度植物 ---------- */\nfunction initPlant(){\n  var box=document.createElement(\'div\');box.className=\'wplant s0\';box.id=\'wplant\';\n  box.innerHTML=\'<svg viewBox="0 0 64 64">\'\n   +\'<path d="M17 51h30l-3.4 10H20.4z" fill="#B8552F"/>\'\n   +\'<rect x="14.5" y="46.5" width="35" height="5" rx="2.4" fill="#8f4122"/>\'\n   +\'<ellipse cx="32" cy="47.5" rx="14" ry="2.2" fill="#6b5b45"/>\'\n   +\'<ellipse class="seed" cx="32" cy="45" rx="3" ry="4" fill="#8a6b3d"/>\'\n   +\'<rect class="stem" x="30.5" y="25" width="3" height="23" rx="1.5" fill="#3f7d3a"/>\'\n   +\'<path class="leaf l1" d="M30.5 41c-7-1.5-10.5-6-10.5-6s5.5-1 10.5 6z" fill="#4f9c46"/>\'\n   +\'<path class="leaf l2" d="M33.5 34c7-1.5 10.5-6 10.5-6s-5.5-1-10.5 6z" fill="#5fae52"/>\'\n   +\'<g class="bloom"><circle cx="32" cy="21" r="4.4" fill="#e0a53c"/>\'\n   +\'<circle cx="32" cy="21" r="2.1" fill="#B8552F"/>\'\n   +\'<circle cx="32" cy="13.6" r="3.4" fill="#e8743c"/></g></svg>\'\n   +\'<span class="wp-num" id="wpNum"></span>\';\n  document.body.appendChild(box);\n  function upd(){\n    var c=curIdx(),p=c.n>1?c.i/(c.n-1):1;\n    box.className=\'wplant s\'+Math.min(5,Math.round(p*5));\n    var n=document.getElementById(\'wpNum\');if(n)n.textContent=(c.i+1)+\'/\'+c.n;\n  }\n  hookPage(upd);upd();\n}\n\n/* ---------- focus：专注模式（按"题"聚焦） ----------\n   开启 → 本页所有题压暗；点某道题 → 这道题整体变亮（不是只亮一行）；\n   未开启时题目保持全亮。↑/↓ 换题，Esc 退出。 */\nfunction initFocus(){\n  var btn=mkBtn(\'🔍\',\'专注\',\'开启后本页题目压暗，点某道题整体变亮；↑/↓ 换题，Esc 退出\');\n  document.getElementById(\'tmr\').appendChild(btn);\n  var fi=-1,items=[];\n  function collect(){\n    var s=document.querySelector(\'.slide.on\');if(!s)return [];\n    return [].slice.call(s.querySelectorAll(\'.q\'));\n  }\n  function paint(){\n    items.forEach(function(e,k){e.classList.toggle(\'fc\',k===fi);});\n    if(fi>=0&&items[fi])items[fi].scrollIntoView({block:\'nearest\'});\n  }\n  function reset(){items=collect();fi=items.length?0:-1;paint();}\n  function step(d){\n    if(fi<0){reset();return;}\n    fi=Math.max(0,Math.min(items.length-1,fi+d));paint();\n  }\n  btn.addEventListener(\'click\',function(e){\n    e.stopPropagation();\n    var on=WB.classList.toggle(\'focus-on\');\n    btn.classList.toggle(\'on\',on);\n    if(on){reset();}else{items.forEach(function(x){x.classList.remove(\'fc\');});fi=-1;}\n  });\n  hookPage(function(){if(WB.classList.contains(\'focus-on\'))reset();});\n  document.addEventListener(\'keydown\',function(e){\n    if(!WB.classList.contains(\'focus-on\'))return;\n    if(e.key===\'ArrowDown\'){e.preventDefault();e.stopPropagation();step(1);}\n    else if(e.key===\'ArrowUp\'){e.preventDefault();e.stopPropagation();step(-1);}\n    else if(e.key===\'Escape\'){btn.click();}\n  });\n  document.addEventListener(\'click\',function(e){\n    if(!WB.classList.contains(\'focus-on\'))return;\n    var s=document.querySelector(\'.slide.on\');\n    var q=e.target;\n    while(q&&q!==document.body&&!(q.classList&&q.classList.contains(\'q\')))q=q.parentNode;\n    if(!q||q===document.body)return;\n    items=collect();var k=items.indexOf(q);\n    if(k>=0){fi=k;paint();}                    // 点哪道题亮哪道题（整道）\n  });\n}\n\n/* ---------- nudge：活动提醒 ---------- */\nfunction initNudge(){\n  var toast=document.createElement(\'div\');toast.className=\'nudge-toast\';toast.id=\'nudgeToast\';\n  toast.innerHTML=\'<span class="nt-t">已经讲了一会儿啦</span>\'\n    +\'<span>来个 30 秒活动？喝水、伸腰，或让同桌互讲一句</span>\'\n    +\'<button class="pri" id="ndBreak" type="button">30 秒休息</button>\'\n    +\'<button id="ndGo" type="button">继续讲</button>\';\n  document.body.appendChild(toast);\n  var shown=0,t1=null;\n  function hide(){toast.classList.remove(\'on\');}\n  document.getElementById(\'ndGo\').addEventListener(\'click\',hide);\n  document.getElementById(\'ndBreak\').addEventListener(\'click\',function(){\n    var b=this,n=30;b.textContent=n+\' 秒\';\n    var t=setInterval(function(){n--;b.textContent=Math.max(0,n)+\' 秒\';\n      if(n<=0){clearInterval(t);b.textContent=\'继续\';hide();}},1000);\n  });\n  // 默认每 12 分钟一次（最多 3 次）；URL 加 ?nudge=5 可改成 5 秒，方便演示\n  var gap=12*60*1000;\n  try{var m=(location.search||\'\').match(/[?&]nudge=(\\d+)/);if(m)gap=Math.max(1,parseInt(m[1],10))*1000;}catch(_){}\n  t1=setInterval(function(){\n    if(shown>=3){clearInterval(t1);return;}\n    shown++;toast.classList.add(\'on\');\n  },gap);\n}\n\n/* ---------- roll：随机抽问（学号，不抽名） ---------- */\nfunction initRoll(){\n  var btn=mkBtn(\'🎲\',\'抽问\',\'随机抽一位同学（抽学号，不点名）\');\n  document.getElementById(\'tmr\').appendChild(btn);\n  var over=document.createElement(\'div\');over.className=\'roll-over\';over.id=\'rollOver\';\n  over.innerHTML=\'<div class="roll-set">人数 <input id="rollN" type="number" min="1" max="200" value="50"></div>\'\n    +\'<div class="roll-num" id="rollNum">–</div>\'\n    +\'<div class="roll-cap" id="rollCap">按「开始」抽学号</div>\'\n    +\'<div class="roll-bar"><button class="pri" id="rollGo" type="button">开始</button>\'\n    +\'<button id="rollClose" type="button">收起</button></div>\';\n  document.body.appendChild(over);\n  var N=50;\n  try{N=parseInt(localStorage.getItem(\'q2h-roll-n\')||\'50\',10)||50;}catch(_){}\n  var input=document.getElementById(\'rollN\');input.value=N;\n  input.addEventListener(\'click\',function(e){e.stopPropagation();});\n  input.addEventListener(\'change\',function(){\n    N=Math.max(1,Math.min(200,parseInt(input.value,10)||50));input.value=N;\n    try{localStorage.setItem(\'q2h-roll-n\',String(N));}catch(_){}\n  });\n  var spin=null;\n  function stopSpin(){if(spin){clearInterval(spin);spin=null;}}\n  function go(){\n    stopSpin();\n    var num=document.getElementById(\'rollNum\'),cap=document.getElementById(\'rollCap\');\n    var target=1+Math.floor(Math.random()*N);\n    var t0=Date.now(),dur=1300;\n    cap.textContent=\'抽签中…\';\n    spin=setInterval(function(){\n      var el=Date.now()-t0;\n      if(el>=dur){\n        stopSpin();num.textContent=target;\n        cap.textContent=\'请 \'+target+\' 号同学回答\';\n        return;\n      }\n      var p=el/dur;                                  // 越转越慢\n      var gap=40+260*p*p;\n      if(!go._last||Date.now()-go._last>=gap){\n        go._last=Date.now();\n        num.textContent=1+Math.floor(Math.random()*N);\n      }\n    },30);\n  }\n  document.getElementById(\'rollGo\').addEventListener(\'click\',function(e){e.stopPropagation();go();});\n  document.getElementById(\'rollClose\').addEventListener(\'click\',function(e){\n    e.stopPropagation();stopSpin();over.classList.remove(\'on\');\n  });\n  btn.addEventListener(\'click\',function(e){\n    e.stopPropagation();\n    if(over.classList.contains(\'on\')){over.classList.remove(\'on\');return;}\n    over.classList.add(\'on\');\n    document.getElementById(\'rollCap\').textContent=\'按「开始」抽学号\';\n  });\n  over.addEventListener(\'click\',function(e){ if(e.target===over){stopSpin();over.classList.remove(\'on\');} });\n  document.addEventListener(\'keydown\',function(e){\n    if(e.key===\'Escape\'&&over.classList.contains(\'on\')){stopSpin();over.classList.remove(\'on\');}\n  });\n}\n\n/* ---------- vote：举手统计 ---------- */\nfunction initVote(){\n  var btn=mkBtn(\'🙋\',\'举手\',\'懂 / 模糊 / 不懂 三键计数，翻页自动清零\');\n  document.getElementById(\'tmr\').appendChild(btn);\n  var panel=document.createElement(\'div\');panel.className=\'vote-panel\';panel.id=\'votePanel\';\n  panel.innerHTML=\'<button class="vp-t" data-k="a">👍 懂<b id="vA">0</b></button>\'\n    +\'<button class="vp-t" data-k="b">🤔 模糊<b id="vB">0</b></button>\'\n    +\'<button class="vp-t" data-k="c">❓ 不懂<b id="vC">0</b></button>\'\n    +\'<button class="vz" id="vZero" type="button">清零</button>\';\n  document.body.appendChild(panel);\n  var cnt={a:0,b:0,c:0};\n  function paint(){\n    document.getElementById(\'vA\').textContent=cnt.a;\n    document.getElementById(\'vB\').textContent=cnt.b;\n    document.getElementById(\'vC\').textContent=cnt.c;\n  }\n  function zero(){cnt={a:0,b:0,c:0};paint();}\n  panel.addEventListener(\'click\',function(e){\n    var b=e.target;\n    while(b&&b!==panel&&!(b.getAttribute&&b.getAttribute(\'data-k\')))b=b.parentNode;\n    if(b&&b.getAttribute&&b.getAttribute(\'data-k\')){cnt[b.getAttribute(\'data-k\')]++;paint();}\n  });\n  document.getElementById(\'vZero\').addEventListener(\'click\',function(e){e.stopPropagation();zero();});\n  btn.addEventListener(\'click\',function(e){\n    e.stopPropagation();\n    var on=panel.classList.toggle(\'on\');\n    btn.classList.toggle(\'on\',on);\n    if(on)zero();                                   // 打开就是新的一题\n  });\n  hookPage(function(){zero();paint();});\n}\n\n/* ---------- exit：要点卡（下课前 2 分钟） ---------- */\nfunction initExit(){\n  var btn=mkBtn(\'🎫\',\'要点卡\',\'下课前 2 分钟：三条提示 + 倒计时\');\n  document.getElementById(\'tmr\').appendChild(btn);\n  var card=document.createElement(\'div\');card.className=\'exit-card\';card.id=\'exitCard\';\n  card.innerHTML=\'<div class="exit-in"><h2>下课前 2 分钟</h2>\'\n    +\'<div class="ex-sub">不看课本，凭记忆写下来</div>\'\n    +\'<ol>\'\n    +\'<li>用自己的话总结今天的<em>重点和记忆点</em>。</li>\'\n    +\'<li>标记<em>还未整理</em>的内容，下课及时整理笔记本。</li>\'\n    +\'<li>还有一个<em>没弄懂</em>的地方是？</li>\'\n    +\'</ol>\'\n    +\'<div class="exit-foot"><span class="ex-t" id="exT">120</span> 秒\'\n    +\'<button class="pri" id="exClose" type="button">收起</button></div></div>\';\n  document.body.appendChild(card);\n  var t=null;\n  function stop(){if(t){clearInterval(t);t=null;}}\n  document.getElementById(\'exClose\').addEventListener(\'click\',function(e){\n    e.stopPropagation();stop();card.classList.remove(\'on\');\n  });\n  btn.addEventListener(\'click\',function(e){\n    e.stopPropagation();\n    if(card.classList.contains(\'on\')){stop();card.classList.remove(\'on\');return;}\n    card.classList.add(\'on\');\n    var n=120;document.getElementById(\'exT\').textContent=n;stop();\n    t=setInterval(function(){\n      n--;document.getElementById(\'exT\').textContent=Math.max(0,n);\n      if(n<=0){stop();document.getElementById(\'exT\').textContent=\'👍\';}\n    },1000);\n  });\n}\n\n/* ---------- allans：本页答案全开 / 全收 ---------- */\nfunction initAllAns(){\n  var btn=mkBtn(\'📖\',\'答案全开\',\'本页所有答案一次展开/收起\');\n  document.getElementById(\'tmr\').appendChild(btn);\n  var openAll=false;\n  function apply(){\n    var s=document.querySelector(\'.slide.on\');if(!s)return;\n    var boxes=s.querySelectorAll(\'.ans\');\n    for(var i=0;i<boxes.length;i++)boxes[i].classList.toggle(\'open\',openAll);\n    btn.querySelector(\'.tx\').textContent=openAll?\'答案全收\':\'答案全开\';\n    btn.classList.toggle(\'on\',openAll);\n  }\n  btn.addEventListener(\'click\',function(e){\n    e.stopPropagation();openAll=!openAll;apply();\n  });\n  hookPage(function(){openAll=false;apply();});\n}\n})();\n';
/* ================= 随机练习页（大屏） =================
   目标：字号不变（沿用正文 var(--u)），一页尽量塞 4~6 道题，
   只写题干、题间距压到最小、中间不留板书空隙。
   做法：运行时按实际可容纳的高度决定放几道（6→4 逐个试），
   绝不缩字——放不下就少放一道。 */
const PRAC_CSS = `
/* ================= 随机练习页 =================
   版式目标：字号与正文完全一致、一屏放下不滚动、题间距最小、只写题干。
   底部预留：nav 那一行 + 手写工具栏（avail() 里还会按实测再扣一次）。 */
.slide-prac{overflow:hidden;
  padding-bottom:calc(var(--pad-y) + var(--barh)*0.4 + 2vh + env(safe-area-inset-bottom));}
.sinner.prac{display:flex;flex-direction:column;height:100%;margin:0 auto;max-width:52em;}
.sinner.prac>*{flex:0 0 auto;}

/* 页眉：左侧短竖条 + 标题 + 紧随其后的说明（不靠右，避免贴近右上角工具栏） */
.prac-hd{display:flex;align-items:baseline;gap:.7em;margin-bottom:.6em;
  padding-left:.7em;border-left:3px solid var(--acc);
  font-family:"PingFang SC","Microsoft YaHei",sans-serif;}
.prac-t{font-size:.68em;font-weight:700;letter-spacing:.18em;color:var(--pri);}
.prac-s{font-size:.54em;color:#9a948a;letter-spacing:.05em;
  font-variant-numeric:tabular-nums;}

/* 题目容器：撑满剩余高度，答案/留白一概不放 */
.prac-box{flex:1 1 auto;min-height:0;overflow:hidden;
  display:flex;flex-direction:column;justify-content:flex-start;gap:0;}
/* 提高特异性，压过通用规则 .sinner.prac>*{flex:0 0 auto}，否则盒高会塌成 0 */
.sinner.prac>.prac-box{flex:1 1 auto;min-height:0;}

/* 一道题：题号徽章 + 题干；虚线极淡，只做视觉分区不抢眼 */
.prac-q{display:flex;gap:.7em;align-items:flex-start;padding:.55em 0;
  border-top:1px solid #EFEAE1;}
.prac-q:first-child{border-top:none;padding-top:0;}
.prac-q:last-child{padding-bottom:0;}
.prac-n{flex:0 0 auto;align-self:flex-start;margin-top:.12em;
  display:inline-flex;align-items:center;justify-content:center;
  width:1.9em;height:1.9em;
  font-family:"PingFang SC","Microsoft YaHei",sans-serif;
  font-size:.58em;font-weight:700;
  color:var(--acc);background:#F8F2EA;border:1px solid #EADFD0;border-radius:5px;
  font-variant-numeric:tabular-nums;line-height:1;}
.prac-c{flex:1 1 auto;min-width:0;}
.prac-c .line{line-height:1.58;}
/* 高公式（分段函数、大分式）默认按 baseline 对齐时会把同一行的文字顶到下面去，
   表现为「已知函数」和公式上下错位。练习页里统一用 middle 对齐，整行才是连贯的一句话。
   只作用于 .prac-c，不影响题目页原有版式。 */
.prac-c .mx{vertical-align:middle;}
.prac-c .mx svg{vertical-align:middle!important;}
.prac-c .line.lv0 .ln{display:none;}      /* 练习页统一用 prac-n 重新编号 */
.prac-c .opts{margin:.06em 0 0;gap:.05em 2em;}

/* 打印：练习页整页照印，只去掉「共N题抽取M道」这种运行期提示 */
@media print{.prac-s{display:none!important;}}
`;
const PRAC_JS = `
(function(){
  var POOL=window.__PRAC||[];
  var box=document.getElementById('pracBox');
  var sub=document.getElementById('pracSub');
  var slide=document.getElementById('pracSlide');
  if(!box||!slide||!POOL.length)return;

  var MAX=parseInt(slide.getAttribute('data-max'),10)||6;  // 一页最多几道，由构建期写入
  var MIN=1;            // 极端情况下的下限：宁可只放一道也不缩字号
  var PAD=2;            // 高度容差（px），避免亚像素误差把能放下的题判成放不下
  var current=[];       // 当前这一批抽好的题目（最多 MAX 道，顺序已打乱）
  var again=null;       // 「换一批」按钮

  function shuffle(a){                        // Fisher-Yates，原地打乱
    for(var i=a.length-1;i>0;i--){
      var j=Math.floor(Math.random()*(i+1));
      var t=a[i];a[i]=a[j];a[j]=t;
    }
    return a;
  }

  function render(list){
    box.innerHTML=list.map(function(o,k){
      return '<div class="prac-q"><span class="prac-n">'+(k+1)+'</span>'
        +'<div class="prac-c">'+o.stem+'</div></div>';
    }).join('');
  }

  /* box 可用的内容高度 = box 自身高度 - 右下角翻页键那一行
     （底部 padding 已经为手写工具栏留好余量）。 */
  function avail(){
    var v=box.clientHeight||0;
    var nav=document.querySelector('.nav');
    if(nav){
      var r=nav.getBoundingClientRect();
      if(r&&r.height)v-=r.height+10;
    }
    return Math.max(0,v);
  }

  /* 量内容真实高度。不能读 box.scrollHeight：box 是 flex:1，
     scrollHeight 永远等于 flex 给它的高度，跟内容多少无关。 */
  function contentH(){
    var last=box.lastElementChild;
    if(!last)return 0;
    var br=box.getBoundingClientRect(),lr=last.getBoundingClientRect();
    return Math.round(lr.bottom-br.top);
  }

  /* 只知道「要显示哪几道」，自己决定显示几道：
     从 MAX 往下试，第一个放得下的就是结果；全放不下就给 MIN 道。 */
  function layout(){
    var n=Math.min(MAX,current.length);
    for(;n>MIN;n--){
      render(current.slice(0,n));
      if(contentH()<=avail()+PAD)break;
    }
    render(current.slice(0,n));               // n 已收敛到能放下的最大数量
    if(sub){
      sub.textContent='共 '+POOL.length+' 题 · 随机抽取 '+n+' 道';
    }
  }

  /* 重新抽一批，再排版 */
  function pick(){
    current=shuffle(POOL.slice()).slice(0,MAX);
    layout();
  }

  /* 「换一批」挂进计时器工具栏（跟其他插件按钮同排），只有停在练习页时才露出来 */
  function mountBar(){
    var bar=document.getElementById('tmr');
    if(!bar||bar.querySelector('#pracAgain'))return;
    again=document.createElement('button');
    again.type='button';again.className='wbtn';again.id='pracAgain';
    again.title='重新随机抽取题目';
    again.innerHTML='<span class="ic">\u{1F500}</span><span class="tx">换一批</span>';
    again.addEventListener('click',function(e){e.stopPropagation();pick();});
    bar.appendChild(again);
    syncBtn();
  }
  function syncBtn(){
    if(!again)return;
    var on=slide.classList.contains('on');
    again.style.display=on?'':'none';
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mountBar);
  else mountBar();

  /* 翻页钩子：进入练习页时，第一次抽题；再回来沿用上一批（老师来回翻页时题目不会变）。
     注意 render() 是先 classList.toggle('on') 再调 __onPage 的，
     所以此刻本页已是 display:flex，量得到高度，同步排版即可。 */
  function onPage(){
    syncBtn();
    if(!slide.classList.contains('on'))return;
    if(!current.length)pick();
    else layout();
  }
  var prev=window.__onPage;
  window.__onPage=function(i){ if(prev)prev(i); onPage(i); };

  /* 缩放窗口只重排（题目不变），用 rAF 节流，避免拖动时反复重排 */
  var raf=0;
  window.addEventListener('resize',function(){
    if(!slide.classList.contains('on'))return;
    if(raf)return;
    raf=requestAnimationFrame(function(){raf=0;layout();});
  });

  // 万一课件打开就停在练习页（单页课件），补一次初始抽题
  if(slide.classList.contains('on'))setTimeout(pick,0);
})();
`;
const PRAC_SCRIPT = '<script>' + PRAC_JS + '<' + '/script>';

const WIDGET_MARKUP = '';
function widgetScript(deck){
  return (deck && deck.widgets && deck.widgets.length)
    ? '<' + 'script>' + WIDGET_JS + '</' + 'script>' : '';
}

/* 练习页一页最多显示几道。这个值同时写进 data-max 供运行时读取，
   改这一处即可（运行时不再硬编码）。 */
const PRAC_MAX = 6;

function buildDeck(deck, pfSrc) {
  const bigTitle = String(deck.title || '习题').replace(/^\d+\s*[_\-\.．]?\s*/, '');
  const kicker = deck.kicker || '高一数学 · 课后习题';
  const lessons = (deck.lessons || []).filter(l => l && (l.questions || []).length);
  if (!lessons.length) throw new Error('deck.lessons 为空：没有可渲染的题目');

  const slides = [], toc = [];
  lessons.forEach(g => {
    const qs = g.questions;
    for (let i = 0; i < qs.length; i += 2) {
      if (i === 0) toc.push({ no: g.no ?? '', nm: g.name || '', start: slides.length + 1 });
      const pair = qs.slice(i, i + 2);
      slides.push(`<section class="slide"><div class="sinner qpage${pair.length === 2 ? ' two' : ''}">` +
        `<div class="runt"><span class="lno">${esc(g.no ?? '')}</span><span class="lnm">${esc(g.name || '')}</span></div>` +
        pair.map(q => questionHTML(q)).join('') + '</div></section>');
    }
  });

  /* ---------- 随机练习页（大屏） ----------
     把全部题目的「题干部分」抽出来存进 window.__PRAC，运行时随机抽 4~6 道铺满一页。
     - 只写题干，不带答案、不留板书空隙、题间距压到最小
     - 字号沿用正文 var(--u)，不缩放；放不下就少放几道，绝不缩字
     - 一次抽不满 4 道也不硬凑（宁可 3 道也不让字变小） */
  /* 只留 stem：练习页按随机编号重新排，不需要课时来源，
     多存字段只会把 HTML 撑大（数学公式的内联 SVG 很占地方）。 */
  const pool = [];
  lessons.forEach(g => (g.questions || []).forEach(q => {
    if (!q || !Array.isArray(q.blocks) || !q.blocks.length) return;
    let stem = '';
    q.blocks.forEach((b, bi) => { stem += blockToHTML(b, bi === 0); });
    if (stem.trim()) pool.push({ stem: stem });
  }));
  const practice = pool.length >= 3 ? `<section class="slide slide-prac" id="pracSlide" data-max="${PRAC_MAX}"><div class="sinner prac">
  <div class="prac-hd"><span class="prac-t">本节小练</span><span class="prac-s" id="pracSub">共 ${pool.length} 题 · 随机抽取</span></div>
  <div class="prac-box" id="pracBox"></div>
</div></section>` : '';
  const pracData = practice
    ? '<script>window.__PRAC=' + JSON.stringify(pool).replace(/</g, '\\u003c') + ';</script>'
    : '';
  /* 「本节小练」不进 toc 数组，单独渲染成目录下方的一行：
     toc 是两栏布局，把它塞进列表里位置会随课时数漂移。 */
  const pracEntry = practice
    ? `<a class="toc-prac" href="javascript:jump(${slides.length + 1})">` +
      `<span class="ico">\u270F</span><span>本节小练</span>` +
      `<span class="tip">随机抽 ${Math.min(PRAC_MAX, pool.length)} 道 · 大屏练习</span></a>`
    : '';

  const cover = `<section class="slide on"><div class="sinner cover">
  <div class="kicker">${esc(kicker)}</div>
  <h1>${esc(bigTitle)}</h1><span class="dash"></span>
  <ul class="toc" style="columns:${toc.length <= 4 ? 1 : 2}">${toc.map(t =>
    `<li><a href="javascript:jump(${t.start})">` +
    `<span class="no">${esc(t.no)}.</span>` +
    `<span class="nm">${esc(t.nm)}</span></a></li>`).join('')}</ul>
  ${pracEntry}
</div></section>`;

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="color-scheme" content="light">
<title>${esc(deck.title || '习题')}</title>
<style>${CSS}${PRAC_CSS}${WIDGET_CSS}</style>
</head>
<body data-widgets="${(deck.widgets||[]).join(',')}">
${pracData}
${cover}
${slides.join('\n')}
${practice}
${PRAC_SCRIPT}
${HW_MARKUP}<div class="tmr" id="tmr">
  <button id="bZoom" class="tmr-btn zm-btn" type="button" title="放大 / 缩小内容（快捷键 + / −）：点开拖动滑块，只放大页面内容，不影响工具栏">
    <b>Aa</b>
  </button>
  <button id="bFs" class="tmr-btn fs-btn" type="button" title="全屏显示（快捷键 F）：字号随屏幕同步放大，电子白板更清晰">
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 6V2h4M14 10v4h-4M10 2h4v4M6 14H2v-4"/></svg><span class="fs-t">全屏</span>
  </button>
  <button id="tmrBtn" class="tmr-btn" type="button" title="倒计时：点我选时长，运行中再点可暂停">⏱ <span id="tmrTxt">计时</span></button>
  <span id="tmrCancel" class="tmr-x" title="取消计时">✕</span>
</div>
<div class="zoom-panel" id="zoomPanel">
  <div class="zp-head"><span>内容缩放</span><b id="zoomVal">100%</b></div>
  <input id="zoomRange" type="range" min="80" max="200" step="5" value="100"
         aria-label="内容缩放比例（80% 到 200%）" title="左右拖动：向左缩小、向右放大">
  <div class="zp-foot">
    <button id="zoomOut" type="button" title="缩小一档（快捷键 −）">−</button>
    <button id="zoomReset" type="button" title="恢复 100%（快捷键 0）">复位 100%</button>
    <button id="zoomIn" type="button" title="放大一档（快捷键 +）">＋</button>
  </div>
</div>
<div class="tmr-menu" id="tmrMenu">
  <button type="button" data-min="1">1 分钟</button>
  <button type="button" data-min="3">3 分钟</button>
  <button type="button" data-min="5">5 分钟</button>
  <button type="button" data-min="10">10 分钟</button>
</div>
<div class="tmr-over" id="tmrOver"><div class="tmr-burst"></div><div class="tmr-msg">时间到</div><div class="tmr-sub" id="tmrSub"></div></div>
${WIDGET_MARKUP}<div class="nav">
  <button id="bPrev" type="button" onclick="go(-1)">‹ 上一页</button>
  <button id="bHome" type="button" onclick="jump(0)" title="回到封面 / 目录页">⌂ 回到首页</button>
  <button id="bNext" type="button" onclick="go(1)">下一页 ›</button>
</div>
<script>
(function(){
  var slides=[].slice.call(document.querySelectorAll('.slide'));
  var cur=0;
  function render(){
    slides.forEach(function(s,i){s.classList.toggle('on',i===cur);});
    document.getElementById('bPrev').disabled=(cur===0);
    document.getElementById('bNext').disabled=(cur===slides.length-1);
    var hb=document.getElementById('bHome');
    if(hb)hb.disabled=(cur===0);
    var sc=document.querySelector('.slide.on');
    if(sc)sc.scrollTop=0;
    if(window.__onPage)window.__onPage(cur);
  }
  window.go=function(d){var n=cur+d;if(n<0||n>=slides.length)return;cur=n;render();};
  window.jump=function(i){cur=i;render();};
  document.addEventListener('keydown',function(e){
    var ae=document.activeElement,tag=ae&&ae.tagName;
    var inField=(tag==='INPUT'||tag==='TEXTAREA'||tag==='SELECT'||(ae&&ae.isContentEditable));
    // 输入框 / 缩放滑块里的方向键交给控件本身（否则会边拖滑块边翻页）
    if(inField)return;
    // 空格键留给聚焦中的按钮（否则点完按钮再按空格会既触发按钮又翻页）；
    // 方向键/翻页键不会误触按钮，保持随时可用。
    if(e.key===' '){ if(tag==='BUTTON')return; }
    if(e.key==='ArrowRight'||e.key==='PageDown'||e.key===' '){e.preventDefault();go(1);}
    else if(e.key==='ArrowLeft'||e.key==='PageUp'){e.preventDefault();go(-1);}
  });
  function tg(btn){ btn.parentNode.classList.toggle('open'); }
  window.tg=tg;
  render();
})();
</script>
${hwScript(pfSrc)}
${widgetScript(deck)}
<script>
(function(){
  /* 全屏切换（2026-10-21 从 l2html 技能移植）。
     浏览器窗口化时 vmin 只是窗口尺寸，点了全屏 vmin 才变成屏幕尺寸，
     --u 才会随屏幕放大（1080p 35.9px / 4K 46px）。 */
  var btn=document.getElementById('bFs');if(!btn)return;
  var lab=btn.querySelector('.fs-t');
  function sync(){
    var on=!!(document.fullscreenElement||document.webkitFullscreenElement);
    if(lab)lab.textContent=on?'退出全屏':'全屏';
    btn.classList.toggle('on',on);
    btn.title=on?'退出全屏（Esc 也可退出）':'全屏显示（快捷键 F）：字号随屏幕同步放大，电子白板更清晰';
  }
  window.__fsToggle=function(){
    var el=document.documentElement;
    try{
      if(document.fullscreenElement||document.webkitFullscreenElement){
        (document.exitFullscreen||document.webkitExitFullscreen).call(document);
      }else{
        (el.requestFullscreen||el.webkitRequestFullscreen).call(el);
      }
    }catch(e){}
  };
  btn.addEventListener('click',function(e){e.stopPropagation();window.__fsToggle();});
  document.addEventListener('fullscreenchange',sync);
  document.addEventListener('webkitfullscreenchange',sync);
  /* F 快捷键。要避开输入框（抽问插件里有个人数输入框），
     也要避开翻页脚本已接管的方向键/空格——F 不在那批里，互不干扰。 */
  document.addEventListener('keydown',function(e){
    if(e.key!=='f'&&e.key!=='F')return;
    var ae=document.activeElement,tag=ae&&ae.tagName;
    if(tag==='INPUT'||tag==='TEXTAREA'||tag==='SELECT'||(ae&&ae.isContentEditable))return;
    if(e.ctrlKey||e.metaKey||e.altKey)return;
    e.preventDefault();e.stopPropagation();
    window.__fsToggle();
  });
  sync();
})();
/* 内容缩放（右上角「Aa」→ 滑块 80%~200%）：与 l2html 同一套方案。
   只缩放 .sinner（--z），工具栏/页码不动；不用滚轮缩放，只用滑块 + −/＋ + 键盘 +/−/0。 */
(function(){
  var MIN=80,MAX=200,STEP=5,z=100;
  var btn=document.getElementById('bZoom'),panel=document.getElementById('zoomPanel'),
      range=document.getElementById('zoomRange'),val=document.getElementById('zoomVal');
  if(!btn||!panel||!range)return;
  function apply(v){
    v=Math.round(v/STEP)*STEP;
    if(v<MIN)v=MIN;if(v>MAX)v=MAX;
    var ratio=v/z;z=v;
    document.documentElement.style.setProperty('--z',(v/100).toFixed(2));
    range.value=v;
    if(val)val.textContent=v+'%';
    btn.classList.toggle('on',v!==100);
    btn.title='放大 / 缩小内容（当前 '+v+'%，快捷键 + / −）：点开拖动滑块，只放大页面内容，不影响工具栏';
    if(window.__inkRescale)window.__inkRescale(ratio);
  }
  window.__zoomTo=apply;
  window.__zoomNow=function(){return z;};
  btn.addEventListener('click',function(e){e.stopPropagation();panel.classList.toggle('show');});
  panel.addEventListener('click',function(e){e.stopPropagation();});
  range.addEventListener('input',function(){apply(+range.value);});
  var zo=document.getElementById('zoomOut'),zi=document.getElementById('zoomIn'),zr=document.getElementById('zoomReset');
  if(zo)zo.onclick=function(){apply(z-10);};
  if(zi)zi.onclick=function(){apply(z+10);};
  if(zr)zr.onclick=function(){apply(100);};
  document.addEventListener('click',function(){panel.classList.remove('show');});
  document.addEventListener('keydown',function(e){
    var ae=document.activeElement,tag=ae&&ae.tagName;
    if(tag==='INPUT'||tag==='TEXTAREA'||tag==='SELECT'||(ae&&ae.isContentEditable))return;
    if(e.key==='+'||e.key==='='){e.preventDefault();apply(z+10);}
    else if(e.key==='-'||e.key==='_'){e.preventDefault();apply(z-10);}
    else if(e.key==='0'){e.preventDefault();apply(100);}
    else if(e.key==='Escape'){panel.classList.remove('show');}
  });
})();
</script>
</body>
</html>
`;
}

/* ================= CLI ================= */
function main() {
  const argv = process.argv.slice(2);
  if (!argv.length || argv[0] === '-h' || argv[0] === '--help') {
    console.log('用法: node render_deck.js <deck.json> [out.html]');
    console.log('  deck.json 结构见 references/schema.md');
    process.exit(argv.length ? 0 : 1);
  }
  const inPath = path.resolve(argv[0]);
  const deck = JSON.parse(fs.readFileSync(inPath, 'utf8'));
  const outPath = path.resolve(argv[1] || String(deck.title || '习题').replace(/^\d+\s*[_\-\.．]?\s*/, '') + '.html');

  const pfSrc = fs.readFileSync(depFile('perfect-freehand/dist/cjs/index.js'), 'utf8')
    .replace(/\/\/# sourceMappingURL=[^\n]*/, '');

  const t0 = Date.now();
  const html = buildDeck(deck, pfSrc);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, html, 'utf8');

  const nQ = (deck.lessons || []).reduce((a, l) => a + ((l.questions || []).length), 0);
  const nA = (deck.lessons || []).reduce((a, l) => a + (l.questions || []).filter(q => q.ans && q.ans.steps && q.ans.steps.length).length, 0);
  console.log(`ok -> ${outPath}`);
  console.log(`  ${(deck.lessons || []).length} 个课时 / ${nQ} 题（${nA} 题带解析）/ ${(fs.statSync(outPath).size / 1048576).toFixed(2)} MB / ${Date.now() - t0} ms`);
  if (nA < nQ) console.log(`  注意：有 ${nQ - nA} 题没有解析`);
}

if (require.main === module) {
  try { main(); } catch (e) { console.error('失败：' + e.message); process.exit(1); }
}
module.exports = { buildDeck };
