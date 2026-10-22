/* ============ 翻页 / 逐步揭示 / 计时 / 页码 ============ */
(function () {
  var slides = [].slice.call(document.querySelectorAll('.slide'));
  var cur = 0;

  function pageEl() { return slides[cur]; }

  /* ---- 逐步揭示 ---- */
  var bar = document.getElementById('rvBar');
  var rtxt = document.getElementById('rvTxt');
  function rvAll() { return [].slice.call(slides[cur].querySelectorAll('.rv')); }
  function rvTodo() { return rvAll().filter(function (e) { return !e.classList.contains('on'); }); }
  function syncRv() {
    if (!bar) return;
    var all = rvAll(), todo = rvTodo();
    if (!all.length || !todo.length) { bar.classList.remove('show'); return; }
    bar.classList.add('show');
    rtxt.textContent = '下一步 ' + (all.length - todo.length + 1) + ' / ' + all.length;
  }
  window.rvNext = function () {
    var todo = rvTodo();
    if (!todo.length) return false;
    todo[0].classList.add('on');
    syncRv();
    return true;
  };
  window.rvAllNow = function () {
    rvTodo().forEach(function (e) { e.classList.add('on'); });
    syncRv();
  };
  if (bar) {
    bar.querySelector('.rv-go').onclick = function () { window.rvNext(); };
    bar.querySelector('.rv-all').onclick = function () { window.rvAllNow(); };
  }

  /* ---- 答案折叠（题目 / 提示 / 参考解答共用） ---- */
  window.tg = function (btn) {
    var box = btn.closest('.tgbox');
    if (!box) return;
    box.classList.toggle('open');
    var mk = btn.querySelector('.mk');
    if (mk) mk.textContent = box.classList.contains('open') ? '▾' : '▸';
  };

  /* ---- 进度条 / 页码 ---- */
  var pace = document.getElementById('pace');
  var pgn = document.getElementById('pgn');

  function render() {
    slides.forEach(function (s, i) { s.classList.toggle('on', i === cur); });
    document.getElementById('bPrev').disabled = (cur === 0);
    document.getElementById('bNext').disabled = (cur === slides.length - 1);
    var hb = document.getElementById('bHome');
    if (hb) hb.disabled = (cur === 0);
    var sc = pageEl();
    if (sc) sc.scrollTop = 0;
    if (pace) pace.style.width = (slides.length > 1 ? (cur / (slides.length - 1) * 100) : 100) + '%';
    if (pgn) pgn.textContent = (cur + 1 < 10 ? '0' : '') + (cur + 1) + ' / ' + slides.length;
    syncRv();
    if (window.__onPage) window.__onPage(cur);
  }

  window.go = function (d) { var n = cur + d; if (n < 0 || n >= slides.length) return; cur = n; render(); };
  window.jump = function (i) { if (i < 0 || i >= slides.length) return; cur = i; render(); };

  document.addEventListener('keydown', function (e) {
    var ae = document.activeElement, tag = ae && ae.tagName;
    var inField = (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (ae && ae.isContentEditable));
    if (inField) return;                    /* 滑块/输入框里的方向键交给控件本身 */
    var onBtn = (tag === 'BUTTON' || inField);
    if (e.key === ' ') {
      if (onBtn) return;
      e.preventDefault();
      if (!window.rvNext()) window.go(1);
      return;
    }
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === 'PageDown') { e.preventDefault(); window.go(1); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'PageUp') { e.preventDefault(); window.go(-1); }
    else if (e.key === 'Home') { e.preventDefault(); window.jump(0); }
    else if (e.key === 'End') { e.preventDefault(); window.jump(slides.length - 1); }
    else if (e.key === 'r' || e.key === 'R') { window.rvNext(); }
    else if (e.key === 'f' || e.key === 'F') { if (window.__fsToggle) window.__fsToggle(); }
  });

  /* 触屏左右滑（非手写模式下） */
  var tx = 0, ty = 0;
  document.addEventListener('touchstart', function (e) {
    if (document.body.classList.contains('hw') || e.touches.length !== 1) return;
    tx = e.touches[0].clientX; ty = e.touches[0].clientY;
  }, { passive: true });
  document.addEventListener('touchend', function (e) {
    if (document.body.classList.contains('hw') || !e.changedTouches.length) return;
    var dx = e.changedTouches[0].clientX - tx, dy = e.changedTouches[0].clientY - ty;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.6) window.go(dx < 0 ? 1 : -1);
  }, { passive: true });

  window.__onPage = function () { };
  render();
})();

/* ============ 倒计时 ============ */
(function () {
  var btn = document.getElementById('tmrBtn'), txt = document.getElementById('tmrTxt'),
    menu = document.getElementById('tmrMenu'), box = document.getElementById('tmr'),
    cx = document.getElementById('tmrCancel'), over = document.getElementById('tmrOver'),
    sub = document.getElementById('tmrSub');
  if (!btn || !over) return;
  var total = 0, left = 0, tick = null, last = 0, running = false, auto = null;
  function fmt(s) { s = Math.max(0, Math.round(s)); var m = Math.floor(s / 60), r = s % 60; return (m < 10 ? '0' : '') + m + ':' + (r < 10 ? '0' : '') + r; }
  function paint() {
    txt.textContent = total ? fmt(left) : '计时';
    box.classList.toggle('run', !!total && running);
    box.classList.toggle('pause', !!total && !running);
    box.classList.toggle('warn', !!total && left <= 60 && left > 0);
  }
  function stopTick() { if (tick) { clearInterval(tick); tick = null; } }
  function start() {
    stopTick(); running = true; last = Date.now();
    tick = setInterval(function () {
      var now = Date.now(); left -= (now - last) / 1000; last = now;
      if (left <= 0) { left = 0; paint(); finish(); return; }
      paint();
    }, 200);
    paint();
  }
  function pause() { stopTick(); running = false; paint(); }
  function cancel() { stopTick(); running = false; total = 0; left = 0; paint(); hide(); menu.classList.remove('show'); }
  function hide() { over.classList.remove('on'); over.onclick = null; if (auto) { clearTimeout(auto); auto = null; } }
  function finish() {
    stopTick(); running = false;
    var used = fmt(total);
    total = 0; left = 0; paint();
    over.classList.add('on');
    sub.textContent = '本次计时 ' + used + ' · 点击任意处关闭';
    beep();
    auto = setTimeout(hide, 10000);
    over.onclick = hide;
  }
  function choose(min) { total = left = min * 60; menu.classList.remove('show'); start(); }
  function beep() {
    try {
      var C = window.AudioContext || window.webkitAudioContext; if (!C) return;
      var ac = new C();
      [0, .2, .4].forEach(function (t) {
        var o = ac.createOscillator(), g = ac.createGain();
        o.type = 'sine'; o.frequency.value = 880;
        g.gain.setValueAtTime(0, ac.currentTime + t);
        g.gain.linearRampToValueAtTime(.22, ac.currentTime + t + .02);
        g.gain.linearRampToValueAtTime(0, ac.currentTime + t + .14);
        o.connect(g); g.connect(ac.destination);
        o.start(ac.currentTime + t); o.stop(ac.currentTime + t + .16);
      });
      setTimeout(function () { try { ac.close(); } catch (_) { } }, 1400);
    } catch (_) { }
  }
  btn.addEventListener('click', function (e) {
    e.stopPropagation();
    if (!total) { menu.classList.toggle('show'); return; }
    running ? pause() : start();
  });
  cx.addEventListener('click', function (e) { e.stopPropagation(); cancel(); });
  menu.addEventListener('click', function (e) {
    var b = e.target;
    while (b && b !== menu && !(b.getAttribute && b.getAttribute('data-min'))) b = b.parentNode;
    if (b && b.getAttribute && b.getAttribute('data-min')) choose(parseInt(b.getAttribute('data-min'), 10));
  });
  document.addEventListener('click', function () { menu.classList.remove('show'); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { hide(); menu.classList.remove('show'); } });
  paint();
})();

/* ============ 内容缩放（右上角「Aa」→ 滑块 80%~200%） ============
   讲课投屏时字仍嫌小的兜底：只缩放 .sinner 内容（--z），工具栏/页码不动；
   .sinner 的 max-width 同步除以 --z，放大后宽度仍锁在视口内，只往下滚。
   不用滚轮缩放（用户明确不要），只用滑块 + −/＋ 按钮 + 键盘 +/−/0。 */
(function () {
  var MIN = 80, MAX = 200, STEP = 5, z = 100;
  var btn = document.getElementById('bZoom');
  var panel = document.getElementById('zoomPanel');
  var range = document.getElementById('zoomRange');
  var val = document.getElementById('zoomVal');
  if (!btn || !panel || !range) return;

  function apply(v) {
    v = Math.round(v / STEP) * STEP;
    if (v < MIN) v = MIN;
    if (v > MAX) v = MAX;
    var ratio = v / z;
    z = v;
    document.documentElement.style.setProperty('--z', (v / 100).toFixed(2));
    range.value = v;
    if (val) val.textContent = v + '%';
    btn.classList.toggle('on', v !== 100);
    btn.title = '放大 / 缩小内容（当前 ' + v + '%，快捷键 + / −）：点开拖动滑块，只放大页面内容，不影响工具栏';
    if (window.__inkRescale) window.__inkRescale(ratio);   /* 手写笔迹跟着内容等比缩放 */
  }
  window.__zoomTo = apply;
  window.__zoomNow = function () { return z; };

  btn.addEventListener('click', function (e) {
    e.stopPropagation();
    panel.classList.toggle('show');
  });
  panel.addEventListener('click', function (e) { e.stopPropagation(); });
  range.addEventListener('input', function () { apply(+range.value); });
  var zo = document.getElementById('zoomOut');
  var zi = document.getElementById('zoomIn');
  var zr = document.getElementById('zoomReset');
  if (zo) zo.onclick = function () { apply(z - 10); };
  if (zi) zi.onclick = function () { apply(z + 10); };
  if (zr) zr.onclick = function () { apply(100); };
  document.addEventListener('click', function () { panel.classList.remove('show'); });
  document.addEventListener('keydown', function (e) {
    var ae = document.activeElement, tag = ae && ae.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (ae && ae.isContentEditable)) return;
    if (e.key === '+' || e.key === '=') { e.preventDefault(); apply(z + 10); }
    else if (e.key === '-' || e.key === '_') { e.preventDefault(); apply(z - 10); }
    else if (e.key === '0') { e.preventDefault(); apply(100); }
    else if (e.key === 'Escape') { panel.classList.remove('show'); }
  });
})();
