#!/usr/bin/env node
/**
 * render.js — 把 content.js 的页面数据渲染成单文件 HTML 新授课课件
 * 用法：node render.js <content.js> [figs.js] [out.html]
 *   content.js  必填，导出 { PAGES }，结构见 references/schema.md
 *   figs.js     可选，导出 { FIGS }（SVG 图形库）；不传则无图可用
 *   out.html    可选，默认 <content.js 同目录>/新授课课件.html
 */
const fs = require('fs');
const path = require('path');

const CONTENT = path.resolve(process.argv[2] || '');
if (!process.argv[2]) {
  console.error('用法：node render.js <content.js> [figs.js] [out.html]');
  process.exit(1);
}
const { PAGES } = require(CONTENT);
const FIGS = process.argv[3] ? require(path.resolve(process.argv[3])).FIGS : {};

/* ---------------- MathJax ---------------- */
/* 依赖解析顺序：L2H_DEPS 环境变量 > 本技能 .deps > q2html 技能 .deps（本机复用） */
function pickDeps() {
  const candidates = [
    process.env.L2H_DEPS,
    path.join(__dirname, '..', '.deps', 'node_modules'),
    '/Users/cc/.workbuddy/skills/q2html/.deps/node_modules',
  ].filter(Boolean);
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, 'mathjax-full'))) return c;
  }
  console.error('找不到 mathjax-full 依赖。请设置 L2H_DEPS 指向 node_modules 目录，'
    + '或在本技能目录执行：npm install mathjax-full perfect-freehand（装入 .deps/）');
  process.exit(1);
}
const DEPS = pickDeps();
function dep(rel) { return require(path.join(DEPS, rel)); }
const { mathjax } = dep('mathjax-full/js/mathjax.js');
const { TeX } = dep('mathjax-full/js/input/tex.js');
const { SVG } = dep('mathjax-full/js/output/svg.js');
const { liteAdaptor } = dep('mathjax-full/js/adaptors/liteAdaptor.js');
const { RegisterHTMLHandler } = dep('mathjax-full/js/handlers/html.js');
const { AllPackages } = dep('mathjax-full/js/input/tex/AllPackages.js');

const adaptor = liteAdaptor();
RegisterHTMLHandler(adaptor);
const texIn = new TeX({ packages: AllPackages, macros: {} });
const svgOut = new SVG({ fontCache: 'local' });
const doc = mathjax.document('', { InputJax: texIn, OutputJax: svgOut });

function tex2svg(latex) {
  const node = doc.convert(latex, { display: false, em: 16, ex: 8, containerWidth: 80 * 16 });
  let html = adaptor.outerHTML(node);
  html = html.replace(/^<mjx-container[^>]*>/, '').replace(/<\/mjx-container>$/, '');
  return html.trim();
}

/* ---------------- 文本解析 ---------------- */
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const CJK = /[\u2e80-\u9fff\uff00-\uffef]/;

function plain(t) {
  return esc(t).replace(/\n/g, '<br>');
}

function inline(c) {
  /* **…** 可能跨越行内公式（如 **不能写 $\cup$**），
     所以先把星号换成占位符，渲染完再落成 <b>，否则加粗会被公式切碎、露出星号 */
  const parts = String(c).split('**');
  let src = '';
  for (let i = 0; i < parts.length; i++) {
    src += parts[i];
    if (i < parts.length - 1) src += (i % 2 === 0) ? '\u0001' : '\u0002';
  }
  let out = '', last = 0, m;
  const re = /\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$/g;
  while ((m = re.exec(src)) !== null) {
    if (m.index > last) out += plain(src.slice(last, m.index));
    if (m[1] != null) {
      out += `<span class="mx mxd">${tex2svg('\\displaystyle ' + m[1])}</span>`;
    } else {
      out += `<span class="mx">${tex2svg(m[2])}</span>`;
    }
    last = re.lastIndex;
  }
  out += plain(src.slice(last));
  return out.replace(/\u0001/g, '<b>').replace(/\u0002/g, '</b>')
    .replace(/\{\{b\}\}/g, '<span class="blank"></span>')
    .replace(/\{\{b2\}\}/g, '<span class="blank s"></span>');
}

/* ---------------- 块渲染 ---------------- */
function rvWrap(html, b) {
  return b.rv ? `<div class="rv">${html}</div>` : html;
}

function renderBlock(b) {
  switch (b.t) {
    case 'p':
      return rvWrap(`<p class="p${b.rv ? ' rvp' : ''}">${inline(b.c)}</p>`, b);
    case 'lead':
      return `<p class="lead">${inline(b.c)}</p>`;
    case 'ul':
      return `<ul class="ul">${b.items.map(i => `<li>${inline(i)}</li>`).join('')}</ul>`;
    case 'def':
      return `<div class="def"><span class="dlab">${esc(b.lab)}</span><div class="dtx">${inline(b.c)}</div></div>`;
    case 'note':
      return rvWrap(`<div class="note ${b.kind}"><span class="nlab">${esc(b.lab)}</span><div class="ntx">${inline(b.c)}</div></div>`, b);
    case 'fig':
      return `<figure class="fig">${FIGS[b.key]()}${b.cap ? `<figcaption class="cap">${inline(b.cap)}</figcaption>` : ''}</figure>`;
    case 'tbl':
      return `<table class="tbl"><thead><tr>${b.head.map(h => `<th>${inline(h)}</th>`).join('')}</tr></thead>`
        + `<tbody>${b.rows.map(r => `<tr>${r.map(c => `<td>${c === '' ? '' : inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
    case 'steps':
      return `<div class="steps">${b.items.map((s, i) => `<div class="step">`
        + `<span class="sn">${i + 1}</span><span class="sl">${esc(s.lab)}</span>`
        + `<div class="sc">${inline(s.c)}</div></div>`).join('')}</div>`;
    case 'chips':
      return `<div class="chips">${b.items.map((c, i) => `<span class="chip"><b class="cn">${'①②③④⑤'[i] || ''}</b>${inline(c)}</span>`).join('')}</div>`;
    case 'eqline':
      return rvWrap(`<div class="eqline">${inline(b.c)}</div>`, b);
    case 'ex':
      return `<div class="ex"><span class="exno">${esc(b.no)}</span><div class="exc">${inline(b.c)}</div></div>`;
    case 'dt':
      return `<div class="dt${b.board ? ' db' : ''}"><span class="dtl">${inline(b.lab)}</span><div class="dtc">${inline(b.c)}</div></div>`;
    case 'num':
      return `<div class="num"><span class="nn">${inline(b.no || '')}</span><div class="nc">${inline(b.c)}</div></div>`;
    case 'sub':
      return `<div class="sub"><span class="sn2">${inline(b.no || '')}</span><div class="nc">${inline(b.c)}</div></div>`;
    case 'opts':
      return `<div class="opts plain">${b.items.map(o => `<div class="opt"><span class="ol">${esc(o[0])}.</span><span class="ob">${inline(o[1])}</span></div>`).join('')}</div>`;
    case 'solf':
      return `<div class="sol"><span class="slab">${esc(b.lab || '解')}</span><div class="solrow">`
        + `<div class="solx">${inline(b.c)}</div>`
        + `<figure class="fig">${FIGS[b.fig]()}</figure></div></div>`;
    case 'sol':
      return `<div class="sol"><span class="slab">${esc(b.lab || '解')}</span>`
        + `<div class="solx">${inline(b.c)}${b.fig ? `<figure class="fig">${FIGS[b.fig]()}</figure>` : ''}</div></div>`;
    case 'dtab':
      return `<table class="dtab">` + b.rows.map(row => '<tr>' + row.map(c => {
        const span = c.span ? ` colspan="${c.span}"` : '';
        const cls = c.h ? ' class="dh"' : '';
        const inner = c.fig ? FIGS[c.fig]() : inline(c.c || '');
        return `<td${span}${cls}>${inner}</td>`;
      }).join('') + '</tr>').join('') + '</table>';
    case 'board':
      return `<div class="board${b.tall ? ' tall' : ''}"><span class="blab">板书 · 演算</span></div>`;
    case 'grid':
      return `<div class="grid c${b.cols || 2}">${b.items.map(c => `<div class="card"><span class="cl">${esc(c.lab)}</span><div class="cc">${inline(c.c)}</div></div>`).join('')}</div>`;
    case 'ans':
      return `<div class="tgbox ans"><button class="abtn" type="button" onclick="tg(this)"><span class="mk">▸</span>${esc(b.lab || '答案')}</button>`
        + `<div class="abody">${inline(b.c)}${b.fig ? `<figure class="fig">${FIGS[b.fig]()}</figure>` : ''}</div></div>`;
    case 'hint':
      return `<div class="tgbox ans hint"><button class="abtn" type="button" onclick="tg(this)"><span class="mk">▸</span>${esc(b.lab || '提示')}</button>`
        + `<div class="abody">${inline(b.c)}</div></div>`;
    case 'qa':
      return `<div class="tgbox qa"><div class="qah"><span class="qno">${esc(b.no || '')}</span>`
        + `<div class="qac">${inline(b.c)}</div>`
        + `<button class="abtn qbtn" type="button" onclick="tg(this)"><span class="mk">▸</span>理由</button></div>`
        + `<div class="abody">${inline(b.a)}</div></div>`;
    case 'exa':
      return `<div class="tgbox exa"><div class="exah"><span class="exno sm">${esc(b.no)}</span>`
        + `<div class="exc">${inline(b.c)}</div>`
        + `<button class="abtn qbtn" type="button" onclick="tg(this)"><span class="mk">▸</span>${esc(b.lab || '答案')}</button></div>`
        + `<div class="abody">${inline(b.a)}</div></div>`;
    case 'q':
      return `<div class="qcard"><span class="qno">${esc(b.no)}</span><div class="qmain">`
        + `<div class="qac">${inline(b.c)}</div>`
        + (b.fig && !b.side ? `<figure class="fig qfig">${FIGS[b.fig]()}</figure>` : '')
        + (b.side ? `<div class="qbody"><div class="opts">`
            + b.opts.map(o => `<div class="opt"><span class="ol">${esc(o[0])}.</span><span class="ob">${inline(o[1])}</span></div>`).join('')
            + `</div><figure class="fig qfig">${FIGS[b.fig]()}</figure></div>` : '')
        + (b.opts && !b.side ? `<div class="opts">${b.opts.map(o => `<div class="opt"><span class="ol">${esc(o[0])}.</span><span class="ob">${inline(o[1])}</span></div>`).join('')}</div>` : '')
        + (b.a ? `<div class="tgbox ans mini"><button class="abtn" type="button" onclick="tg(this)"><span class="mk">▸</span>答案</button><div class="abody">${inline(b.a)}</div></div>` : '')
        + `</div></div>`;
    default:
      return '';
  }
}

/* ---------------- 页面 ---------------- */
function pageHTML(p, idx) {
  if (p.type === 'cover') return coverHTML(p);
  const blocks = p.blocks.map(renderBlock).join('\n');
  return `<section class="slide" data-i="${idx}">
<div class="sinner page">
  <header class="ph">
    <div class="prow"><span class="ptag">${esc(p.tag || '')}</span>${p.time ? `<span class="ptime">${esc(p.time)}</span>` : ''}</div>
    <h2 class="ptitle">${inline(p.title)}</h2>
    <span class="prule"></span>
  </header>
  <div class="pbody">
${blocks}
  </div>
</div>
</section>`;
}

function coverHTML(p) {
  // 目录 → 页码映射：页标签形如「一 · 学习目标」，取开头中文数字做键。
  // 注意 PAGES[0] 是封面，pageHTML 的 idx 与 jump() 的 0 基索引一一对应，不能 +1。
  const tagMap = {};
  PAGES.forEach((q, i) => {
    if (!q.tag) return;
    const m = q.tag.match(/^\s*([一二三四五六七八九十]+)\s*[·、.]/);
    if (m && tagMap[m[1]] === undefined) tagMap[m[1]] = i;
  });
  const toc = p.toc.map(t => `<a href="javascript:jump(${tagMap[t[0]] ?? 0})">`
    + `<span class="tn">${esc(t[0])}</span>`
    + `<span class="tt"><b>${esc(t[1])}</b></span></a>`).join('');

  return `<section class="slide on" data-i="0">
<div class="sinner cover">
  <div class="kicker">${esc(p.kicker)}</div>
  <h1>${esc(p.title)}</h1>
  <div class="csub">${inline(p.sub)}</div>
  ${p.lead ? `<div class="clead">${inline(p.lead)}</div>` : ''}
  <div class="crule"></div>
  <div class="toc">${toc}</div>
  <div class="cfoot">${esc(p.foot || '')}</div>
</div>
</section>`;
}

/* ---------------- CSS ---------------- */
const CSS = String.raw`
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
:root{
  /* 正文字号随屏幕短边缩放（vmin）；上限 46px 保证 4K 电子白板全屏时字也够大。
     1080p 实测 28.5px、4K 全屏 46px，比例与屏幕同步放大。 */
  --u:clamp(16px,1.9vmin + 8px,46px);
  --pad-x:clamp(22px,4.8vmin,78px);
  --pad-y:clamp(14px,2.7vmin,34px);
  --pri:#1F3A5F; --acc:#B8552F; --ink:#232323; --mut:#8A857C;
  --box:#FAF8F4; --rule:#D9D3C7; --chip:#E9EEF4;
  --warnbg:#FBF1EE; --warnink:#9C3D2E;
  --barh:150px;
  /* 内容缩放系数（右上角「Aa」滑块控制 0.8~2.0）。只作用于 .sinner，
     角落工具栏/页码不跟着放大；max-width 同步除以 --z，放大时宽度仍锁在视口内。 */
  --z:1;
}
html{-webkit-text-size-adjust:100%;text-size-adjust:100%;}
body{
  background:#fff;color:var(--ink);
  font-family:"Songti SC","Source Han Serif SC","Noto Serif SC","SimSun",serif;
  font-size:var(--u);line-height:1.95;overflow:hidden;
}
b{font-weight:700;}

.slide{display:none;position:fixed;inset:0;overflow-y:auto;
  padding:calc(var(--pad-y) + 10px) var(--pad-x) calc(var(--pad-y) + 6vh);
  padding-bottom:calc(var(--pad-y) + var(--barh) + 3vh + env(safe-area-inset-bottom));
  -webkit-overflow-scrolling:touch;}
.slide.on{display:flex;flex-direction:column;animation:fade .26s ease;}
@keyframes fade{from{opacity:0;transform:translateY(8px);}to{opacity:1;transform:none;}}
.sinner{flex:0 0 auto;margin:0 auto;width:100%;zoom:var(--z);max-width:min(47em,100%);}
.sinner.page>*{flex:0 0 auto;}

/* ---------- 封面 ---------- */
.sinner.cover{margin:auto;max-width:min(44em,100%);text-align:center;padding-top:clamp(10px,3vh,44px);}
.cover .kicker{font-family:"PingFang SC","Microsoft YaHei",sans-serif;font-size:.56em;
  letter-spacing:.3em;color:var(--acc);font-weight:600;margin-bottom:1.15em;}
.cover h1{font-size:1.72em;font-weight:700;letter-spacing:.06em;line-height:1.3;}
.cover .csub{font-family:"PingFang SC","Microsoft YaHei",sans-serif;font-size:.64em;
  letter-spacing:.2em;color:var(--mut);margin-top:.7em;}
.cover .clead{margin:1.05em auto 0;max-width:23em;font-size:.82em;line-height:1.95;color:#4a4a4a;}
.cover .crule{width:3em;height:2px;background:var(--acc);margin:1.15em auto 1em;border-radius:2px;opacity:.8;}
.cover .toc{display:grid;grid-template-columns:1fr 1fr;gap:.1em 2.2em;text-align:left;max-width:38em;margin:0 auto;}
.cover .toc a{display:flex;gap:.8em;align-items:flex-start;text-decoration:none;color:inherit;
  padding:.34em .5em;border-radius:5px;border-bottom:1px solid #F2EDE3;transition:background .15s;}
.cover .toc a:hover{background:#F8F4EC;}
.cover .toc .tn{flex:0 0 auto;font-family:"PingFang SC",sans-serif;font-size:.82em;font-weight:700;
  color:var(--acc);width:1.5em;text-align:center;line-height:1.75;margin-top:.1em;}
.cover .toc .tt{flex:1 1 auto;min-width:0;}
.cover .toc b{display:block;font-size:.95em;font-weight:700;color:var(--pri);letter-spacing:.06em;}
.cover .toc i{display:block;font-style:normal;font-size:.7em;color:var(--mut);letter-spacing:.03em;margin-top:.1em;}
.cover .cfoot{margin-top:1.4em;padding-top:.8em;border-top:1px solid #F0EBE1;
  font-family:"PingFang SC",sans-serif;font-size:.56em;color:#B4ADA0;letter-spacing:.14em;}

/* ---------- 页眉 ---------- */
.ph{margin-bottom:.85em;}
.prow{display:flex;align-items:center;gap:.6em;}
.ptag{display:inline-flex;align-items:center;gap:.55em;
  font-family:"PingFang SC","Microsoft YaHei",sans-serif;font-size:.58em;font-weight:700;
  letter-spacing:.22em;color:var(--acc);}
.ptag::before{content:'';display:block;width:1.7em;height:2px;background:var(--acc);opacity:.85;}
.ptime{margin-left:auto;font-family:"PingFang SC",sans-serif;font-size:.54em;
  color:#B7B0A3;letter-spacing:.1em;}
.ptitle{font-size:1.22em;font-weight:700;line-height:1.45;letter-spacing:.02em;margin-top:.26em;}
.prule{display:block;width:2.8em;height:3px;background:var(--acc);margin-top:.5em;border-radius:2px;opacity:.9;}

/* ---------- 正文 ---------- */
.pbody>*:first-child{margin-top:0;}
.p{margin:.45em 0;line-height:1.9;}
.p.rvp{margin:.42em 0;}
.ul{margin:.5em 0 .5em 1.1em;list-style:none;}
.ul li{position:relative;padding-left:1.05em;margin:.34em 0;line-height:1.95;}
.ul li::before{content:'';position:absolute;left:0;top:.78em;width:.36em;height:.36em;
  border:1.6px solid var(--acc);border-radius:50%;}
.lead{font-size:1.02em;line-height:2;color:#333;}

/* 定义卡 */
.def{position:relative;margin:.6em 0;padding:.72em 1em .72em 1.1em;
  background:linear-gradient(180deg,#FCFAF6,#F8F5EE);
  border:1px solid #EBE4D5;border-left:4px solid var(--pri);border-radius:0 4px 4px 0;}
.def .dlab{display:block;font-family:"PingFang SC",sans-serif;font-size:.58em;font-weight:700;
  letter-spacing:.24em;color:var(--pri);margin-bottom:.45em;opacity:.9;}
.def .dtx{line-height:1.95;}

/* 提示卡 */
.note{display:flex;gap:.7em;align-items:flex-start;margin:.6em 0;padding:.52em .85em;
  border-radius:4px;font-size:.93em;line-height:1.82;}
.note .nlab{flex:0 0 auto;font-family:"PingFang SC",sans-serif;font-size:.6em;font-weight:700;
  letter-spacing:.14em;padding:.4em .55em;border-radius:3px;line-height:1;margin-top:.42em;color:#fff;}
.note .ntx{flex:1 1 auto;min-width:0;}
.note.key{background:#F2F5F9;}
.note.key .nlab{background:var(--pri);}
.note.tip{background:#FBF5EF;}
.note.tip .nlab{background:var(--acc);}
.note.tip .ntx{font-family:"Songti SC",serif;}
.note.warn{background:var(--warnbg);}
.note.warn .nlab{background:var(--warnink);}

/* 图 */
.fig{margin:.6em 0;text-align:center;}
.fig svg{max-width:100%;height:auto;}
.fig .cap{font-family:"PingFang SC",sans-serif;font-size:.62em;color:var(--mut);
  letter-spacing:.06em;margin-top:.5em;line-height:1.7;}
.fig.qfig{margin:.6em 0 .2em;}
.fig.qfig svg{max-height:9.4em;width:auto;}

/* 表 */
.tbl{width:100%;border-collapse:collapse;font-size:.92em;margin:.6em 0;table-layout:fixed;}
.tbl th{font-family:"PingFang SC",sans-serif;font-size:.92em;font-weight:700;letter-spacing:.1em;
  color:#fff;background:var(--pri);padding:.46em .4em;text-align:center;}
.tbl th:first-child{border-radius:3px 0 0 0;}
.tbl th:last-child{border-radius:0 3px 0 0;}
.tbl td{padding:.3em .4em;border-bottom:1px solid #EAE4D8;text-align:center;vertical-align:middle;line-height:1.6;}
.tbl tbody tr:last-child td{border-bottom:1.5px solid #C9C1B1;}
.tbl td:first-child{text-align:left;font-weight:600;color:var(--pri);}

/* 步骤 */
.steps{margin:.7em 0;}
.step{display:flex;gap:.8em;padding:.38em 0;border-bottom:1px dashed #EDE7DA;align-items:flex-start;}
.step:last-child{border-bottom:none;}
.step .sn{flex:0 0 auto;width:1.65em;height:1.65em;border-radius:50%;background:var(--pri);color:#fff;
  font-family:"PingFang SC",sans-serif;font-size:.68em;font-weight:700;
  display:flex;align-items:center;justify-content:center;margin-top:.34em;}
.step .sl{flex:0 0 auto;font-family:"PingFang SC",sans-serif;font-size:.72em;font-weight:700;
  letter-spacing:.1em;color:var(--pri);min-width:4.6em;margin-top:.26em;}
.step .sc{flex:1 1 auto;min-width:0;line-height:1.9;}

/* 关键词 */
.chips{display:flex;flex-wrap:wrap;gap:.4em;margin:.55em 0;}
.chip{display:inline-flex;align-items:baseline;gap:.42em;background:var(--chip);border-radius:4px;
  padding:.3em .68em;font-size:.9em;line-height:1.7;}
.chip .cn{font-family:"PingFang SC",sans-serif;font-size:.8em;color:var(--pri);font-weight:700;}

/* 例题行 */
.ex{display:flex;gap:.7em;align-items:baseline;margin:.62em 0 .35em;}
.exno{flex:0 0 auto;font-family:"PingFang SC",sans-serif;font-size:.66em;font-weight:700;
  letter-spacing:.1em;color:#fff;background:var(--acc);padding:.4em .6em;border-radius:3px;line-height:1;white-space:nowrap;}
.exc{flex:1 1 auto;min-width:0;}

/* 公式行 */
.eqline{margin:.25em 0 .25em 1.4em;line-height:1.95;overflow-x:auto;overflow-y:hidden;}
.mx{display:inline-block;vertical-align:baseline;max-width:100%;}
.mx svg{display:block;max-width:100%;height:auto;}
.mxd{display:block;margin:.1em 0;}
.mxd svg{max-width:100%;}
.eqline .mxd{display:block;}

/* 板书区 */
.board{position:relative;margin:.7em 0 0;min-height:14vh;border-radius:4px;}
.board.tall{min-height:26vh;}
.board .blab{position:absolute;right:.3em;top:-.15em;font-family:"PingFang SC",sans-serif;
  font-size:.52em;letter-spacing:.24em;color:#CBC2AF;}

/* 卡片网格 */
.grid{display:grid;gap:.65em;margin:.72em 0;}
.grid.c2{grid-template-columns:1fr 1fr;}
.card{background:var(--box);border:1px solid #EFE9DC;border-radius:5px;padding:.62em .85em;}
.card .cl{display:block;font-family:"PingFang SC",sans-serif;font-size:.6em;font-weight:700;
  letter-spacing:.18em;color:var(--acc);margin-bottom:.3em;}
.card .cc{font-size:.96em;line-height:1.82;}


/* ---------- 学案式条目 ---------- */
.dt{display:grid;grid-template-columns:7.2em 1fr;gap:.9em;padding:.6em 0;
  border-bottom:1px dashed #EDE7DA;align-items:baseline;}
.dt:last-child{border-bottom:none;}
.dt .dtl{font-family:"PingFang SC",sans-serif;font-size:.7em;font-weight:700;letter-spacing:.08em;
  color:var(--acc);line-height:2.1;text-align:right;}
.dt .dtc{min-width:0;line-height:1.95;}
.num{display:flex;gap:.5em;align-items:baseline;margin:.5em 0;line-height:1.95;}
.num .nn{flex:0 0 auto;font-weight:700;color:var(--pri);min-width:3.1em;}
.num .nc{flex:1 1 auto;min-width:0;}
.sub{display:flex;gap:.5em;align-items:baseline;margin:.35em 0 .35em 1.8em;line-height:1.9;font-size:.96em;}
.sub .sn2{flex:0 0 auto;font-weight:600;color:#5B6B80;min-width:2.15em;}
.sub .nc{flex:1 1 auto;min-width:0;}


/* 解答块（讲解页常驻显示） */
.sol{margin:.55em 0;padding:.65em 1em .7em 1.1em;background:#FBF9F4;
  border:1px solid #EEE7D9;border-left:3px solid var(--acc);border-radius:0 4px 4px 0;}
.sol .slab{display:block;font-family:"PingFang SC",sans-serif;font-size:.58em;font-weight:700;
  letter-spacing:.22em;color:var(--acc);margin-bottom:.35em;}
.sol .solx{line-height:1.95;}


.solrow{display:flex;gap:1.5em;align-items:center;}
.solrow .solx{flex:1 1 auto;min-width:0;}
.solrow .fig{flex:0 0 40%;margin:0;text-align:center;}
.solrow .fig svg{width:100%;height:auto;}

/* ---------- 定义对照表 ---------- */
.dtab{width:100%;border-collapse:collapse;margin:.5em 0;font-size:.92em;}
.dtab td{border:1px solid #E7E0D2;padding:.5em .7em;text-align:center;vertical-align:middle;line-height:1.85;}
.dtab td.dh{width:4.2em;background:#F5F1E9;font-family:"PingFang SC",sans-serif;font-size:.88em;
  font-weight:700;letter-spacing:.1em;color:var(--pri);}
.dtab td svg{max-width:100%;height:auto;}
.blank.s{min-width:1.7em;}

/* 例题备选区：留白略浅 */
.opts.plain{margin:.4em 0 .25em 4.4em;}

/* 答案折叠 */
.tgbox{margin-top:.4em;}
.abtn{font-family:"PingFang SC",sans-serif;font-size:.58em;font-weight:600;letter-spacing:.12em;
  color:var(--pri);background:#fff;border:1px solid var(--rule);border-radius:3px;
  padding:.58em 1em;cursor:pointer;transition:background .18s,color .18s,border-color .18s;
  -webkit-tap-highlight-color:transparent;}
.abtn:hover{background:var(--pri);color:#fff;border-color:var(--pri);}
.abtn .mk{display:inline-block;margin-right:.4em;font-size:.9em;}
.tgbox.open>.abtn{background:var(--pri);color:#fff;border-color:var(--pri);}
.abody{display:none;margin-top:.5em;padding:.55em .85em;background:var(--box);
  border-left:3px solid var(--acc);border-radius:0 3px 3px 0;line-height:1.88;}
.tgbox.open>.abody{display:block;animation:fin .24s ease;}
@keyframes fin{from{opacity:0;transform:translateY(-3px);}to{opacity:1;transform:none;}}
.ans.mini>.abtn{font-size:.54em;padding:.5em .85em;color:var(--acc);border-color:#E6D8C9;}
.ans.mini>.abtn:hover{background:var(--acc);border-color:var(--acc);color:#fff;}
.ans.mini.open>.abtn{background:var(--acc);border-color:var(--acc);color:#fff;}
.ans.hint>.abtn{color:#6E7B8B;border-color:#DCE2EA;background:#FAFBFD;}

/* 原 .ans 遗留（保留以防引用） */
.ans{margin-top:.4em;}


/* 辨析题 */
.qa{margin:.4em 0;padding:.3em 0 .42em;border-bottom:1px dashed #EFE9DC;}
.qa:last-of-type{border-bottom:none;}
.qah{display:flex;gap:.45em;align-items:baseline;}
.qac{flex:1 1 auto;min-width:0;line-height:1.88;}
.qno{display:inline-block;flex:0 0 auto;font-family:"PingFang SC",sans-serif;font-size:.82em;
  font-weight:700;color:var(--acc);}
.qbtn{flex:0 0 auto;font-size:.52em!important;padding:.52em .7em!important;letter-spacing:.08em!important;
  color:var(--acc);border-color:#E6D8C9;background:transparent;}
.qbtn:hover{background:var(--acc)!important;border-color:var(--acc)!important;color:#fff!important;}
.qa .abody,.exa .abody{margin-left:1.7em;margin-top:.35em;font-size:1em;}
.qa.open>.qbtn,.exa.open>.qbtn{background:var(--acc);border-color:var(--acc);color:#fff;}

/* 例题（右侧答案） */
.exa{margin:.28em 0;padding:.2em 0 .34em;border-bottom:1px dashed #F1EBDD;}
.exa:last-of-type{border-bottom:none;}
.exah{display:flex;gap:.6em;align-items:center;}
.exah .exc{flex:1 1 auto;min-width:0;line-height:1.9;}
.exno.sm{font-size:.58em;padding:.38em .55em;}

/* 当堂检测题 */
.qcard{display:flex;gap:.6em;padding:.58em 0;border-top:1px dashed #EAE4D6;}
.qcard:first-child{border-top:none;padding-top:0;}
.qcard>.qno{flex:0 0 auto;width:1.55em;height:1.55em;border-radius:4px;background:var(--pri);color:#fff;
  font-family:"PingFang SC",sans-serif;font-size:.58em;font-weight:700;
  display:flex;align-items:center;justify-content:center;margin-top:.5em;}
.qmain{flex:1 1 auto;min-width:0;}
.opts{display:grid;grid-template-columns:1fr 1fr;gap:.12em 1.8em;margin:.42em 0 .1em .1em;}

/* 图文并排的检测题 */
.qbody{display:flex;gap:1.5em;align-items:center;margin:.35em 0 .1em;}
.qbody .opts{flex:1 1 auto;margin:0;gap:.15em 1.6em;grid-template-columns:1fr;}
.qbody .fig{flex:0 0 18em;margin:0;}
.qbody .fig svg{width:100%;height:auto;max-height:none;}

.opt{display:flex;gap:.42em;align-items:baseline;font-size:.94em;}
.opt .ol{flex:0 0 auto;font-weight:700;color:var(--pri);}
.blank{display:inline-block;min-width:2.3em;border-bottom:1.5px solid #A8A093;margin:0 .3em;
  transform:translateY(-.14em);}

/* 逐步揭示 */
.rv{display:none;}
.rv.on{display:block;animation:fin .28s ease;}
.rvbar{position:fixed;left:50%;transform:translateX(-50%);
  bottom:calc(44px + env(safe-area-inset-bottom));
  z-index:56;display:none;align-items:center;gap:.35em;
  font-family:"PingFang SC",sans-serif;}
.rvbar.show{display:flex;}
.rvbar button{font-size:max(12px,.56em);font-weight:600;color:var(--pri);background:#fff;
  border:1px solid var(--rule);border-radius:5px;padding:.5em .8em;cursor:pointer;line-height:1;
  white-space:nowrap;box-shadow:0 1px 4px rgba(0,0,0,.05);-webkit-tap-highlight-color:transparent;}
.rvbar button:hover{background:var(--pri);color:#fff;border-color:var(--pri);}
.rvbar .rv-all{color:#9a948a;border-style:dashed;padding:.5em .6em;font-weight:500;}

/* 顶部进度条 */
.pace{position:fixed;top:0;left:0;height:2.5px;background:var(--acc);z-index:58;width:0;
  transition:width .32s ease;box-shadow:0 0 6px rgba(184,85,47,.45);}

/* 页码 */
#pgn{position:fixed;left:50%;bottom:calc(12px + env(safe-area-inset-bottom));
  transform:translateX(-50%);z-index:40;pointer-events:none;
  font-family:"PingFang SC",sans-serif;font-size:11px;letter-spacing:.14em;color:#BFB7A8;
  font-variant-numeric:tabular-nums;}

/* 翻页 */
.nav{position:fixed;right:clamp(12px,2.6vmin,26px);bottom:calc(14px + env(safe-area-inset-bottom));
  z-index:50;display:flex;align-items:center;gap:.45em;font-family:"PingFang SC",sans-serif;}
.nav button{font-size:max(13px,.6em);font-weight:600;color:var(--pri);background:#fff;
  border:1px solid var(--rule);border-radius:5px;padding:.55em .95em;cursor:pointer;line-height:1;
  transition:background .16s,color .16s,border-color .16s;-webkit-tap-highlight-color:transparent;}
.nav button:hover:not(:disabled){background:var(--pri);color:#fff;border-color:var(--pri);}
.nav button:disabled{opacity:.28;cursor:default;}
.nav #bHome{font-weight:500;color:var(--acc);background:transparent;border-style:dashed;}
.nav #bHome:hover:not(:disabled){background:var(--acc);border-color:var(--acc);color:#fff;}

/* 手写 */
#ink{position:fixed;inset:0;z-index:45;pointer-events:none;touch-action:none;}
body.hw #ink{pointer-events:auto;cursor:crosshair;}
body.hw,body.hw *{-webkit-user-select:none!important;user-select:none!important;
  -webkit-touch-callout:none!important;-webkit-user-drag:none!important;}
.hwbar{position:fixed;left:clamp(12px,2.6vmin,26px);bottom:calc(14px + env(safe-area-inset-bottom));
  z-index:60;display:flex;flex-wrap:wrap;gap:.4em;align-items:center;max-width:calc(100vw - 24px);
  font-family:"PingFang SC",sans-serif;}
.hwbar button{font-size:max(13px,.6em);font-weight:600;color:var(--pri);background:#fff;
  border:1px solid var(--rule);border-radius:5px;padding:.55em .85em;cursor:pointer;line-height:1;
  white-space:nowrap;transition:background .16s,color .16s,border-color .16s;
  -webkit-tap-highlight-color:transparent;}
.hwbar button:hover{background:var(--pri);color:#fff;border-color:var(--pri);}
#tPrint,#hwtg{background:var(--pri);color:#fff;border-color:var(--pri);}
body.hw #hwtg{background:#fff;color:var(--pri);}
.inkprint{display:none;}
#hwtools{display:none;gap:.4em;align-items:center;flex-wrap:wrap;}
#hwtools.show{display:flex;}
.hwbar button.on{background:var(--acc);border-color:var(--acc);color:#fff;}
@media (max-width:620px){.hwbar{max-width:calc(100vw - 210px);}}

/* 倒计时 */
.tmr{position:fixed;top:calc(10px + env(safe-area-inset-top));right:clamp(10px,2.4vmin,24px);
  z-index:55;display:flex;align-items:center;gap:.25em;font-family:"PingFang SC",sans-serif;}
.tmr-btn{font-size:max(12px,.54em);font-weight:600;color:var(--pri);background:#fff;
  border:1px solid var(--rule);border-radius:5px;padding:.42em .7em;cursor:pointer;line-height:1;
  font-variant-numeric:tabular-nums;white-space:nowrap;box-shadow:0 1px 4px rgba(0,0,0,.06);
  transition:background .16s,color .16s,border-color .16s;-webkit-tap-highlight-color:transparent;}
.tmr-btn:hover{background:var(--pri);color:#fff;border-color:var(--pri);}
/* 全屏按钮：与计时器同工具栏；.on = 正在全屏 */
.fs-btn{display:inline-flex;align-items:center;gap:.4em;}
.fs-btn svg{display:block;width:1.05em;height:1.05em;}
.fs-btn.on{background:var(--pri);color:#fff;border-color:var(--pri);}
/* 缩放按钮 + 面板：Aa 点开滑块，80%~200%（讲课投屏看不清时直接放大整页内容） */
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
  font-size:max(12px,.56em);color:var(--mut);letter-spacing:.08em;margin-bottom:.55em;}
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
.tmr .tmr-x{display:none;font-size:max(11px,.5em);color:#8a857c;cursor:pointer;padding:.2em .35em;
  border-radius:4px;line-height:1;}
.tmr .tmr-x:hover{background:#eee;color:#444;}
.tmr.run .tmr-x,.tmr.pause .tmr-x{display:inline-block;}
.tmr.run .tmr-btn{background:var(--pri);color:#fff;border-color:var(--pri);}
.tmr.pause .tmr-btn{opacity:.62;}
.tmr.warn .tmr-btn{background:var(--acc);border-color:var(--acc);color:#fff;
  animation:tmrPulse 1s ease-in-out infinite;}
@keyframes tmrPulse{0%,100%{transform:scale(1)}50%{transform:scale(1.07)}}
.tmr-menu{position:fixed;top:calc(46px + env(safe-area-inset-top));right:clamp(10px,2.4vmin,24px);
  z-index:56;display:none;grid-template-columns:1fr 1fr;gap:.3em;padding:.4em;background:#fff;
  border:1px solid var(--rule);border-radius:8px;box-shadow:0 8px 26px -10px rgba(0,0,0,.28);
  font-family:"PingFang SC",sans-serif;}
.tmr-menu.show{display:grid;animation:fin .18s ease;}
.tmr-menu button{font-size:max(12px,.54em);font-weight:600;color:var(--pri);background:#fff;
  border:1px solid var(--rule);border-radius:5px;padding:.5em .8em;cursor:pointer;line-height:1;
  white-space:nowrap;-webkit-tap-highlight-color:transparent;}
.tmr-menu button:hover{background:var(--pri);color:#fff;border-color:var(--pri);}
.tmr-over{position:fixed;inset:0;z-index:200;display:none;align-items:center;justify-content:center;
  background:radial-gradient(circle at center,rgba(31,58,95,.94),rgba(20,32,52,.98));overflow:hidden;}
.tmr-over.on{display:flex;animation:ovIn .28s ease both;}
@keyframes ovIn{from{opacity:0}to{opacity:1}}
.tmr-msg{position:relative;font-family:"PingFang SC",sans-serif;font-weight:800;
  font-size:clamp(46px,15vmin,150px);color:#fff;letter-spacing:.14em;line-height:1.1;
  text-shadow:0 8px 34px rgba(0,0,0,.4);animation:msgPop .55s cubic-bezier(.2,1.7,.4,1) both;}
@keyframes msgPop{0%{transform:scale(.35);opacity:0}62%{transform:scale(1.1)}100%{transform:scale(1);opacity:1}}
.tmr-sub{position:absolute;bottom:20%;color:rgba(255,255,255,.82);font-family:"PingFang SC",sans-serif;
  font-size:clamp(13px,2.4vmin,22px);letter-spacing:.22em;font-weight:500;}

/* 窄屏 */
@media (max-width:620px){
  :root{--barh:250px;}
  .cover h1{font-size:1.45em;}
  .cover .toc{grid-template-columns:1fr;}
  .cover .clead{font-size:.82em;}
  .grid.c2{grid-template-columns:1fr;}
  .opts{grid-template-columns:1fr;}
  .step .sl{min-width:3.6em;font-size:.6em;}
  .tbl{font-size:.88em;}
  #bFs{display:none;}   /* 手机本身即全屏应用，且 iOS 不支持元素全屏，隐藏免误点 */
  #pgn{display:none;}
}

/* 手按 Cmd+P 的兜底版式（点导出按钮时会注入另一份压住它） */
@media print{
  @page{size:A4;margin:16mm 15mm;}
  body{overflow:visible;background:#fff;font-size:11.5pt;line-height:1.95;}
  .nav,.hwbar,#ink,.tmr,.tmr-menu,.zoom-panel,.rvbar,#pgn,.pace{display:none!important;}
  .slide{display:block!important;position:static;overflow:visible;padding:0;
    animation:none!important;break-after:page;page-break-after:always;}
  .slide:last-of-type{break-after:auto;page-break-after:auto;}
  .sinner{margin:0;max-width:none;}
  .rv{display:block!important;}
}
`;

/* ---------------- 组装 ---------------- */
function build() {
  const cv = PAGES.find(p => p.type === 'cover') || {};
  const slides = PAGES.map((p, i) => pageHTML(p, i)).join('\n');
  const pfSrc = fs.readFileSync(path.join(DEPS, 'perfect-freehand/dist/cjs/index.js'), 'utf8')
    .replace(/\/\/# sourceMappingURL=[^\n]*/, '');
  const hwJs = fs.readFileSync(path.join(__dirname, 'client/hw.js'), 'utf8');
  const deckJs = fs.readFileSync(path.join(__dirname, 'client/deck.js'), 'utf8');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="color-scheme" content="light">
<title>${esc(cv.title)}${cv.sub ? ' · ' + esc(cv.sub) : ''}</title>
<style>${CSS}</style>
</head>
<body>
<div class="pace" id="pace"></div>
${slides}
<canvas id="ink"></canvas>
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
<div class="rvbar" id="rvBar">
  <button class="rv-go" type="button"><span id="rvTxt">下一步</span></button>
  <button class="rv-all" type="button">全部</button>
</div>
<div class="tmr" id="tmr">
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
<div class="tmr-over" id="tmrOver"><div class="tmr-msg">时间到</div><div class="tmr-sub" id="tmrSub"></div></div>
<div class="nav">
  <button id="bPrev" type="button" onclick="go(-1)">‹ 上一页</button>
  <button id="bHome" type="button" onclick="jump(0)" title="回到封面 / 目录页">⌂ 回到首页</button>
  <button id="bNext" type="button" onclick="go(1)">下一页 ›</button>
</div>
<div id="pgn"></div>
<script>${deckJs}<\/script>
<script>window.pf=(function(){var exports={};${pfSrc};return exports;})();<\/script>
<script>${hwJs}<\/script>
<script>
(function(){
  /* 全屏切换：进入后 vmin 随屏幕变大，--u 同步放大（4K 白板 46px / 1080p 28.5px） */
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
  btn.addEventListener('click',window.__fsToggle);
  document.addEventListener('fullscreenchange',sync);
  document.addEventListener('webkitfullscreenchange',sync);
  sync();
})();
<\/script>
</body>
</html>`;
}

const out = path.resolve(process.argv[4]
  || path.join(path.dirname(CONTENT), '新授课课件.html'));
fs.writeFileSync(out, build(), 'utf8');
console.log('ok -> ' + out);
console.log('   ' + PAGES.length + ' 页 / ' + (fs.statSync(out).size / 1048576).toFixed(2) + ' MB');
