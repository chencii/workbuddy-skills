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
    fs.writeFileSync(path.join(DEPS, 'package.json'), JSON.stringify({ name: 'exercise-deck-deps', private: true }, null, 1));
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
  --u: clamp(17px, 2.4vmin + 10px, 30px);
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
.sinner{flex:0 0 auto;margin:auto;width:100%;max-width:46em;}
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
.toc .pgs{flex:0 0 auto;font-family:"PingFang SC","Microsoft YaHei",sans-serif;
  font-size:.62em;color:#8a857c;font-variant-numeric:tabular-nums;}

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
.nav .pg{font-size:max(12px,.58em);color:#8a857c;font-variant-numeric:tabular-nums;
  letter-spacing:.08em;padding:0 .35em;user-select:none;}
.nav .pg b{color:var(--pri);font-weight:600;}

/* ---------- 手写层 / 导出（仅 -尝试手写 版本注入） ---------- */
#ink{position:fixed;inset:0;z-index:45;pointer-events:none;touch-action:none;}
body.hw #ink{pointer-events:auto;cursor:crosshair;}
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
function redraw(){
  ctx.setTransform(dpr,0,0,dpr,0,0);
  ctx.clearRect(0,0,innerWidth,innerHeight);
  ctx.globalCompositeOperation='source-over';
  drawStrokes(ctx,pages[cur]||[],-scrollTopNow());
}
/* 笔迹用「页面内容坐标」存储：y = clientY + 当前页 scrollTop。
   这样内容上下滚动时笔迹跟着一起走，而不是钉在屏幕上不动。
   （Path2D 带缓存，滚动重绘不重复算轮廓） */
/* 取当前页元素：优先认 .on 类。导出时其余页会被临时摘出 DOM，
   那时按下标取会错位，认 .on 才稳。 */
function curEl(){return document.querySelector('.slide.on')||document.querySelectorAll('.slide')[cur]||null;}
function scrollTopNow(){var el=curEl();return el?el.scrollTop:0;}
/* 轮廓只算一次，canvas 与 SVG 两条渲染路径共用 */
function outlineOf(s){
  var n=s.points.length;
  if(s._o&&s._n===n)return s._o;
  s._o=pf.getStroke(s.points,{size:s.tool==='eraser'?eraserSize:s.size,thinning:.55,smoothing:.55,streamline:.45,easing:function(t){return t},start:{taper:0},end:{taper:0}});
  s._n=n;return s._o;
}
function strokePath(s){
  var n=s.points.length;
  if(s._p&&s._n===n)return s._p;
  var o=outlineOf(s);
  if(!o||!o.length){s._p=null;return null;}
  var p=new Path2D();p.moveTo(o[0][0],o[0][1]);
  for(var i=1;i<o.length;i++)p.lineTo(o[i][0],o[i][1]);
  p.closePath();s._p=p;return p;
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
window.__onPage=function(i){cur=i;redraw();};
function pt(e){return [e.clientX,e.clientY+scrollTopNow(),Math.max(.08,e.pressure||.5)];}
/* 手写模式下触屏单指写字、双指上下拖动翻内容（否则开着书写就没法滚动） */
var active={},panning=null;
function cancelStroke(){
  if(!stroking)return;
  var arr=pages[cur]||[],i=arr.indexOf(stroking);
  if(i>=0)arr.splice(i,1);
  stroking=null;redraw();
}
cv.addEventListener('pointerdown',function(e){
  if(!document.body.classList.contains('hw'))return;
  e.preventDefault();
  active[e.pointerId]={y:e.clientY};
  if(Object.keys(active).length>1){          // 第二根手指 → 切到拖动模式
    cancelStroke();
    panning={y:e.clientY,top:scrollTopNow()};
    return;
  }
  try{cv.setPointerCapture(e.pointerId);}catch(_){}
  stroking={tool:tool,color:tool==='red'?'#c0392b':penColor,size:penSize,points:[pt(e)]};
  (pages[cur]=pages[cur]||[]).push(stroking);
  redraw();
});
cv.addEventListener('pointermove',function(e){
  if(active[e.pointerId])active[e.pointerId].y=e.clientY;
  if(panning){
    e.preventDefault();
    var el=curEl();if(el)el.scrollTop=panning.top-(e.clientY-panning.y);
    return;
  }
  if(!stroking)return;
  e.preventDefault();
  stroking.points.push(pt(e));
  redraw();
});
function end(e){
  if(e&&e.pointerId!=null)delete active[e.pointerId];
  if(Object.keys(active).length<2)panning=null;
  if(!Object.keys(active).length)stroking=null;
}
cv.addEventListener('pointerup',end);cv.addEventListener('pointercancel',end);cv.addEventListener('pointerleave',end);
var tg=document.getElementById('hwtg');
var tPen=document.getElementById('tPen'),tRed=document.getElementById('tRed'),tEr=document.getElementById('tEr');
if(tg){tg.onclick=function(){
  var on=document.body.classList.toggle('hw');
  var tl=document.getElementById('hwtools');
  if(tl)tl.classList.toggle('show',on);
  tg.textContent=on?'✔ 结束书写':'✎ 手写';
  syncBar();
  redraw();
};}
function mark(btn){[tPen,tRed,tEr].forEach(function(b){if(b)b.classList.toggle('on',b===btn);});}
if(tPen)tPen.onclick=function(){tool='pen';mark(this);};
if(tRed)tRed.onclick=function(){tool='red';mark(this);};
if(tEr)tEr.onclick=function(){tool='eraser';mark(this);};
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
    +'html .nav,html .hwbar,html #ink{display:none!important;}'
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
  };
}
var tP=document.getElementById('tPrint');
if(tP)tP.onclick=function(){
  var cleanup=preparePrint(),done=false;
  function fin(){if(done)return;done=true;cleanup();window.removeEventListener('afterprint',fin);}
  window.addEventListener('afterprint',fin);
  setTimeout(function(){window.print();},80);
};
resize();
})();
${close}`;
}

/* ================= 组装成一个 HTML ================= */
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
  const total = slides.length + 1;
  const cover = `<section class="slide on"><div class="sinner cover">
  <div class="kicker">${esc(kicker)}</div>
  <h1>${esc(bigTitle)}</h1><span class="dash"></span>
  <ul class="toc">${toc.map(t =>
    `<li><a href="javascript:jump(${t.start})"><span class="no">${esc(t.no)}.</span>` +
    `<span class="nm">${esc(t.nm)}</span></a></li>`).join('')}</ul>
</div></section>`;

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="color-scheme" content="light">
<title>${esc(deck.title || '习题')}</title>
<style>${CSS}</style>
</head>
<body>
${cover}
${slides.join('\n')}
${HW_MARKUP}<div class="nav">
  <button id="bPrev" type="button" onclick="go(-1)">‹ 上一页</button>
  <span class="pg"><b id="pgNow">1</b> / ${total}</span>
  <button id="bNext" type="button" onclick="go(1)">下一页 ›</button>
</div>
<script>
(function(){
  var slides=[].slice.call(document.querySelectorAll('.slide'));
  var cur=0;
  function render(){
    slides.forEach(function(s,i){s.classList.toggle('on',i===cur);});
    document.getElementById('pgNow').textContent=cur+1;
    document.getElementById('bPrev').disabled=(cur===0);
    document.getElementById('bNext').disabled=(cur===slides.length-1);
    var sc=document.querySelector('.slide.on');
    if(sc)sc.scrollTop=0;
    if(window.__onPage)window.__onPage(cur);
  }
  window.go=function(d){var n=cur+d;if(n<0||n>=slides.length)return;cur=n;render();};
  window.jump=function(i){cur=i;render();};
  document.addEventListener('keydown',function(e){
    // 空格键留给聚焦中的按钮（否则点完按钮再按空格会既触发按钮又翻页）；
    // 方向键/翻页键不会误触按钮，保持随时可用。
    if(e.key===' '){
      var ae=document.activeElement,tag=ae&&ae.tagName;
      if(tag==='BUTTON'||tag==='INPUT'||tag==='TEXTAREA'||tag==='SELECT'||(ae&&ae.isContentEditable))return;
    }
    if(e.key==='ArrowRight'||e.key==='PageDown'||e.key===' '){e.preventDefault();go(1);}
    else if(e.key==='ArrowLeft'||e.key==='PageUp'){e.preventDefault();go(-1);}
  });
  function tg(btn){ btn.parentNode.classList.toggle('open'); }
  window.tg=tg;
  render();
})();
</script>
${hwScript(pfSrc)}
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
