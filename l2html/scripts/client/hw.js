/* ============ 手写层（备课批注） ============
   与 q2html 同一套方案：笔迹按「页面内容坐标」存储、静态层 + 增量烘焙、
   Apple Pencil 掌拒、coalesced 采样、缓存只留当前页。 */
(function () {
  var pf = window.pf;
  if (!pf || !pf.getStroke) return;
  var cv = document.getElementById('ink');
  if (!cv) return;
  var ctx = cv.getContext('2d');
  var dpr = Math.min(2, window.devicePixelRatio || 1);
  var pages = {}, cur = 0, stroking = null;
  var tool = 'pen', penColor = '#1c1c1e', penSize = 4.2, eraserSize = 18, busy = false;

  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = Math.round(innerWidth * dpr);
    cv.height = Math.round(innerHeight * dpr);
    cv.style.width = innerWidth + 'px';
    cv.style.height = innerHeight + 'px';
    redraw();
  }
  window.addEventListener('resize', resize);

  function addPoint(p) {
    var pts = stroking.points, lp = pts[pts.length - 1];
    var gap = (tool === 'eraser') ? 2.2 : 1.3;
    if (lp) { var dx = p[0] - lp[0], dy = p[1] - lp[1]; if (dx * dx + dy * dy < gap * gap) return; }
    pts.push(p);
  }

  var stCv = document.createElement('canvas');
  var stx = stCv.getContext('2d');
  var stKey = '';

  function bakeStatic(list, upto) {
    stCv.width = cv.width; stCv.height = cv.height;
    stx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawStrokes(stx, upto === undefined ? list : list.slice(0, upto), -scrollTopNow());
  }
  function staticKey(n) { return cur + '|' + n + '|' + Math.round(scrollTopNow()) + '|' + cv.width + 'x' + cv.height; }

  function redraw() {
    var list = pages[cur] || [];
    var n = stroking ? list.length - 1 : list.length;
    var k = staticKey(n);
    if (k !== stKey) { bakeStatic(list, n); stKey = k; }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.drawImage(stCv, 0, 0);
    if (stroking) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, -scrollTopNow() * dpr);
      drawStrokes(ctx, [stroking], 0);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
  }

  var drawQ = false;
  function requestDraw() {
    if (drawQ) return;
    drawQ = true;
    requestAnimationFrame(function () { drawQ = false; redraw(); });
  }

  var curSlide = null;
  function curEl() {
    var el = curSlide;
    if (el && el.classList && el.classList.contains('on')) return el;
    el = document.querySelector('.slide.on') || document.querySelectorAll('.slide')[cur] || null;
    curSlide = el; return el;
  }
  function scrollTopNow() { var el = curEl(); return el ? el.scrollTop : 0; }

  function outlineOf(s) {
    var n = s.points.length;
    if (s._o && s._n === n) return s._o;
    s._o = pf.getStroke(s.points, {
      size: s.size,                       /* 笔画自带尺寸（橡皮三档各笔独立，换档不动旧笔迹） */
      thinning: .55, smoothing: .55, streamline: .45,
      easing: function (t) { return t; }, start: { taper: 0 }, end: { taper: 0 }
    });
    s._n = n; return s._o;
  }
  function strokePath(s) {
    var n = s.points.length;
    if (s._p && s._n === n) return s._p;
    var o = outlineOf(s);
    if (!o || !o.length) { s._p = null; return null; }
    var p = new Path2D();
    p.moveTo(o[0][0], o[0][1]);
    for (var i = 1; i < o.length; i++) p.lineTo(o[i][0], o[i][1]);
    p.closePath(); s._p = p; s._o = null;
    return p;
  }
  function drawStrokes(x, strokes, dy) {
    x.save();
    if (dy) x.translate(0, dy);
    for (var i = 0; i < strokes.length; i++) {
      var s = strokes[i], p = strokePath(s);
      if (!p) continue;
      if (s.tool === 'eraser') { x.globalCompositeOperation = 'destination-out'; x.fillStyle = '#000'; x.fill(p); x.globalCompositeOperation = 'source-over'; }
      else { x.fillStyle = s.color; x.fill(p); }
    }
    x.restore();
  }

  var rafId = 0;
  document.addEventListener('scroll', function () {
    if (rafId || busy) return;
    rafId = requestAnimationFrame(function () { rafId = 0; redraw(); });
  }, true);

  function dropCaches() {
    for (var k in pages) {
      var list = pages[k]; if (!list) continue;
      for (var j = 0; j < list.length; j++) { list[j]._p = null; list[j]._o = null; list[j]._n = -1; list[j]._d = undefined; }
    }
  }

  /* 内容缩放（右上角 Aa 滑块）后，笔迹坐标跟着等比换算，
     否则放大过的页面里原来的批注会「漂」到别处。 */
  window.__inkRescale = function (ratio) {
    if (!ratio || ratio === 1) return;
    for (var k in pages) {
      var list = pages[k] || [];
      for (var i = 0; i < list.length; i++) {
        var pts = list[i].points;
        for (var j = 0; j < pts.length; j++) { pts[j][0] *= ratio; pts[j][1] *= ratio; }
        list[i]._p = null; list[i]._o = null; list[i]._n = -1;
        list[i]._d = undefined; list[i]._dn = undefined;
      }
    }
    stKey = '';
    redraw();
  };

  (function () {
    var old = window.__onPage;
    window.__onPage = function (i) {
      cur = i; curSlide = null;
      dropCaches();
      redraw();
      if (old) old(i);
    };
  })();

  function pt(e) { return [e.clientX, e.clientY + scrollTopNow(), Math.max(.08, e.pressure || .5)]; }

  var active = {}, panning = null, strokePid = null, pens = {};
  function cancelStroke() {
    if (!stroking) return;
    var arr = pages[cur] || [], i = arr.indexOf(stroking);
    if (i >= 0) arr.splice(i, 1);
    stroking = null; strokePid = null; redraw();
  }
  function beginStroke(e) {
    strokePid = e.pointerId;
    try { cv.setPointerCapture(e.pointerId); } catch (_) { }
    stroking = { tool: tool, color: tool === 'red' ? '#c0392b' : penColor, size: (tool === 'eraser' ? eraserSize : penSize), points: [pt(e)] };
    (pages[cur] = pages[cur] || []).push(stroking);
    redraw();
  }
  cv.addEventListener('pointerdown', function (e) {
    if (!document.body.classList.contains('hw')) return;
    e.preventDefault();
    if (e.pointerType === 'pen') {
      pens[e.pointerId] = 1; panning = null;
      if (stroking && strokePid !== e.pointerId) cancelStroke();
      beginStroke(e); return;
    }
    if (Object.keys(pens).length) return;
    active[e.pointerId] = { y: e.clientY };
    if (Object.keys(active).length > 1) {
      cancelStroke();
      panning = { y: e.clientY, top: scrollTopNow() };
      return;
    }
    beginStroke(e);
  });
  cv.addEventListener('pointermove', function (e) {
    if (active[e.pointerId]) active[e.pointerId].y = e.clientY;
    if (panning) {
      if (e.pointerType === 'pen') return;
      e.preventDefault();
      var el = curEl(); if (el) el.scrollTop = panning.top - (e.clientY - panning.y);
      return;
    }
    if (!stroking || e.pointerId !== strokePid) return;
    e.preventDefault();
    var evs = null;
    try { evs = e.getCoalescedEvents ? e.getCoalescedEvents() : null; } catch (_) { evs = null; }
    if (evs && evs.length) { for (var i = 0; i < evs.length; i++) addPoint(pt(evs[i])); }
    else { addPoint(pt(e)); }
    requestDraw();
  });
  function end(e) {
    var pid = (e && e.pointerId != null) ? e.pointerId : null;
    var mine = (pid != null && pid === strokePid && !!stroking);
    if (mine && e && e.clientX != null) {
      var p = pt(e), pts = stroking.points, lp = pts[pts.length - 1];
      if (!lp || Math.abs(p[0] - lp[0]) > 0.4 || Math.abs(p[1] - lp[1]) > 0.4) pts.push(p);
    }
    if (pid != null) { delete active[pid]; delete pens[pid]; }
    if (Object.keys(active).length < 2) panning = null;
    if (mine) {
      var fin = stroking;
      stroking = null; strokePid = null;
      try {
        stx.setTransform(dpr, 0, 0, dpr, 0, 0);
        drawStrokes(stx, [fin], -scrollTopNow());
        stKey = staticKey(pages[cur] || []);
      } catch (_) { stKey = ''; }
      redraw();
      return;
    }
    if (!Object.keys(active).length && !Object.keys(pens).length) { stroking = null; strokePid = null; }
    requestDraw();
  }
  cv.addEventListener('pointerup', end);
  cv.addEventListener('pointercancel', end);
  ['touchstart', 'touchmove'].forEach(function (t) {
    cv.addEventListener(t, function (e) { if (document.body.classList.contains('hw')) e.preventDefault(); }, { passive: false });
  });

  var tg = document.getElementById('hwtg');
  var tPen = document.getElementById('tPen'), tRed = document.getElementById('tRed'), tEr = document.getElementById('tEr');
  /* 橡皮三档：点橡皮进橡皮模式；已在橡皮模式时再点循环 细→中→粗。
     每笔的擦除尺寸随笔画记录（s.size），换档不会让旧笔迹重算变形。 */
  var ER = [14, 26, 44], ERN = ['细', '中', '粗'], erIdx = 1;
  function applyEr() {
    eraserSize = ER[erIdx];
    if (tEr) {
      tEr.textContent = '橡皮·' + ERN[erIdx];
      tEr.title = '橡皮（当前' + ERN[erIdx] + '）：已在橡皮模式时再点一下切换粗细';
    }
  }
  applyEr();
  if (tg) {
    tg.onclick = function () {
      var on = document.body.classList.toggle('hw');
      var tl = document.getElementById('hwtools');
      if (tl) tl.classList.toggle('show', on);
      tg.textContent = on ? '✔ 结束书写' : '✎ 手写';
      if (on && window.getSelection) { try { window.getSelection().removeAllRanges(); } catch (_) { } }
      pens = {}; strokePid = null; panning = null;
      syncBar();
      redraw();
    };
  }
  function noSel(e) { if (document.body.classList.contains('hw')) e.preventDefault(); }
  document.addEventListener('selectstart', noSel, false);
  document.addEventListener('contextmenu', noSel, false);
  document.addEventListener('dragstart', noSel, false);
  function mark(btn) { [tPen, tRed, tEr].forEach(function (b) { if (b) b.classList.toggle('on', b === btn); }); }
  if (tPen) tPen.onclick = function () { tool = 'pen'; mark(this); };
  if (tRed) tRed.onclick = function () { tool = 'red'; mark(this); };
  if (tEr) tEr.onclick = function () {
    if (tool !== 'eraser') { tool = 'eraser'; mark(this); return; }
    erIdx = (erIdx + 1) % ER.length;
    applyEr();
  };
  var tC = document.getElementById('tClear'); if (tC) tC.onclick = function () { pages[cur] = []; redraw(); };
  var tA = document.getElementById('tAll'); if (tA) tA.onclick = function () { pages = {}; redraw(); };

  var bar = document.querySelector('.hwbar');
  function syncBar() {
    if (!bar || busy) return;
    var r = bar.getBoundingClientRect();
    var need = Math.ceil(r.height + (innerHeight - r.bottom) + 16);
    document.documentElement.style.setProperty('--barh', need + 'px');
    var nav = document.querySelector('.nav');
    if (nav) {
      var avail = Math.floor(nav.getBoundingClientRect().left - r.left - 12);
      bar.style.maxWidth = Math.max(150, avail) + 'px';
    }
  }
  window.__syncBar = syncBar;
  syncBar();
  if (window.ResizeObserver) { try { new ResizeObserver(function () { syncBar(); }).observe(bar); } catch (_) { } }
  window.addEventListener('resize', function () { syncBar(); });
  window.addEventListener('orientationchange', function () { syncBar(); });
  setTimeout(function () { syncBar(); }, 350);

  /* ---------- 导出 PDF：浏览器原生打印管线，纯矢量 ---------- */
  function svgOutline(s) {
    var n = s.points.length;
    if (s._d !== undefined && s._dn === n) return s._d;
    var o = outlineOf(s), d = '';
    if (o && o.length) {
      d = 'M' + o[0][0].toFixed(1) + ' ' + o[0][1].toFixed(1);
      for (var i = 1; i < o.length; i++) d += 'L' + o[i][0].toFixed(1) + ' ' + o[i][1].toFixed(1);
      d += 'Z';
    }
    s._d = d; s._dn = n; return d;
  }
  var SVGNS = 'http://www.w3.org/2000/svg';

  function preparePrint() {
    /* 打印固定按 100% 输出：临时复位内容缩放（--z），并把笔迹坐标还原到 100% 尺度，
       打印结束（cleanup）再原样恢复，导出的 PDF 版面与屏幕上「未放大」时一致。 */
    var root = document.documentElement;
    var zRaw = parseFloat(root.style.getPropertyValue('--z'));
    if (!isFinite(zRaw) || zRaw <= 0) zRaw = 1;
    if (zRaw !== 1) {
      root.style.setProperty('--z', '1');
      if (window.__inkRescale) window.__inkRescale(1 / zRaw);
    }
    var stale = document.getElementById('printSheet');
    if (stale) stale.parentNode.removeChild(stale);
    var staleSvg = document.querySelectorAll('svg.inkprint');
    for (var q = 0; q < staleSvg.length; q++) staleSvg[q].parentNode.removeChild(staleSvg[q]);
    var all = [].slice.call(document.querySelectorAll('.slide'));
    for (var q = 0; q < all.length; q++) {
      var cl = all[q].classList, kill = [];
      for (var j = 0; j < cl.length; j++) if (cl[j].indexOf('pgi') === 0) kill.push(cl[j]);
      for (j = 0; j < kill.length; j++) cl.remove(kill[j]);
    }
    var vw = Math.round(innerWidth);
    busy = true;
    var keepOn = -1;
    for (var i = 0; i < all.length; i++) if (all[i].classList.contains('on')) keepOn = i;
    if (keepOn < 0) { keepOn = 0; all[0].classList.add('on'); }
    var base = getComputedStyle(all[keepOn]);
    var bodyCS = getComputedStyle(document.body);
    var hs = [], prev = keepOn;
    for (i = 0; i < all.length; i++) {
      if (prev !== i) all[prev].classList.remove('on');
      all[i].classList.add('on');
      hs.push(Math.max(all[i].clientHeight, all[i].scrollHeight));
      prev = i;
    }
    all[prev].classList.remove('on');
    all[keepOn].classList.add('on');

    var css = '@page{size:' + vw + 'px ' + Math.round(innerHeight) + 'px;margin:0;}';
    var added = [];
    for (i = 0; i < all.length; i++) {
      var cn = 'pgi' + i, h = hs[i], maskId = 'pmk' + i;
      all[i].classList.add(cn); added.push(cn);
      css += '@page ' + cn + '{size:' + vw + 'px ' + h + 'px;margin:0;}'
        + '.slide.' + cn + '{page:' + cn + ';height:' + h + 'px!important;min-height:0!important;overflow:hidden!important;}';
      var st = pages[i] || [];
      if (!st.length) continue;
      var pens = [], eras = [], defs = '';
      for (var j2 = 0; j2 < st.length; j2++) {
        var d = svgOutline(st[j2]); if (!d) continue;
        var p = document.createElementNS(SVGNS, 'path');
        p.setAttribute('d', d);
        if (st[j2].tool === 'eraser') { p.setAttribute('fill', '#000'); eras.push(p); }
        else { p.setAttribute('fill', st[j2].color); pens.push(p); }
      }
      if (!pens.length && !eras.length) continue;
      var svg = document.createElementNS(SVGNS, 'svg');
      svg.setAttribute('class', 'inkprint');
      svg.setAttribute('viewBox', '0 0 ' + vw + ' ' + h);
      svg.setAttribute('preserveAspectRatio', 'none');
      svg.style.cssText = 'position:absolute;left:0;top:0;width:' + vw + 'px;height:' + h + 'px;pointer-events:none';
      if (eras.length) {
        defs = document.createElementNS(SVGNS, 'defs');
        var mk = document.createElementNS(SVGNS, 'mask');
        mk.setAttribute('id', maskId); mk.setAttribute('maskUnits', 'userSpaceOnUse');
        mk.setAttribute('x', '0'); mk.setAttribute('y', '0');
        mk.setAttribute('width', vw); mk.setAttribute('height', h);
        var r = document.createElementNS(SVGNS, 'rect');
        r.setAttribute('x', '0'); r.setAttribute('y', '0');
        r.setAttribute('width', vw); r.setAttribute('height', h);
        r.setAttribute('fill', '#fff');
        mk.appendChild(r);
        eras.forEach(function (e) { mk.appendChild(e); });
        defs.appendChild(mk); svg.appendChild(defs);
        var g = document.createElementNS(SVGNS, 'g');
        g.setAttribute('mask', 'url(#' + maskId + ')');
        pens.forEach(function (e) { g.appendChild(e); });
        svg.appendChild(g);
      } else {
        pens.forEach(function (e) { svg.appendChild(e); });
      }
      all[i].appendChild(svg);
    }

    var lhNum = parseFloat(bodyCS.lineHeight) / parseFloat(bodyCS.fontSize);
    if (!isFinite(lhNum) || lhNum <= 0) lhNum = 1.95;
    css += '@media print{'
      + 'html,html body{overflow:visible!important;background:#fff!important;font-size:' + bodyCS.fontSize + '!important;line-height:' + lhNum.toFixed(3) + '!important;}'
      + 'html *,html *::before,html *::after{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;}'
      + 'html .nav,html .hwbar,html #ink,html .tmr,html .tmr-menu,html .zoom-panel,html .rvbar,html #pgn,html .pace{display:none!important;}'
      + 'html .slide{display:block!important;position:relative!important;top:auto!important;left:auto!important;right:auto!important;bottom:auto!important;'
      + 'width:' + vw + 'px!important;margin:0!important;animation:none!important;transition:none!important;'
      + 'padding:' + base.paddingTop + ' ' + base.paddingRight + ' ' + base.paddingBottom + ' ' + base.paddingLeft + '!important;'
      + 'break-after:page!important;page-break-after:always!important;}'
      + 'html .slide:last-of-type{break-after:auto!important;page-break-after:auto!important;}'
      + 'html .sinner{margin:0 auto!important;max-width:46em!important;min-height:0!important;}'
      + 'html .rv{display:block!important;}'
      + 'html .inkprint{display:block!important;}'
      + '}';
    var style = document.createElement('style');
    style.id = 'printSheet'; style.setAttribute('media', 'print'); style.textContent = css;
    document.head.appendChild(style);
    busy = false;
    return function cleanup() {
      var s2 = document.getElementById('printSheet'); if (s2) s2.parentNode.removeChild(s2);
      for (var k = 0; k < added.length; k++) all[k].classList.remove(added[k]);
      var svgs = document.querySelectorAll('svg.inkprint');
      for (k = 0; k < svgs.length; k++) svgs[k].parentNode.removeChild(svgs[k]);
      if (zRaw !== 1) {
        root.style.setProperty('--z', zRaw.toFixed(2));
        if (window.__inkRescale) window.__inkRescale(zRaw);
      }
    };
  }
  window.__preparePrint = preparePrint;   // 供自动化自检调用
  var tP = document.getElementById('tPrint');
  if (tP) tP.onclick = function () {
    var cleanup = preparePrint(), done = false;
    function fin() { if (done) return; done = true; cleanup(); window.removeEventListener('afterprint', fin); }
    window.addEventListener('afterprint', fin);
    setTimeout(function () { window.print(); }, 80);
  };
  resize();
})();
