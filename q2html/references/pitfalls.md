# 改代码前必读：这套课件踩过的坑

渲染器 `scripts/render_deck.js` 里的每一处"看起来多余"的写法，都是踩坑后补上的。
**改 CSS / 加功能前先看这一页**，否则很容易把已经解决的问题重新引入。

---

## 一、版式方面

### 1. 内容超高时会被 flex 压扁（最坑的一个）

`.slide` 是整屏滚动容器，内部 `.sinner` → `.q` 是纵向 flex 布局。
**flex 子项默认 `flex-shrink:1`**，内容超过一屏时不会撑开滚动，而是被压扁，
多出来的部分直接溢出到左下角工具栏底下——怎么滚都看不见。

所以有：

```css
.sinner{flex:0 0 auto;}
.sinner.qpage>*{flex:0 0 auto;}
```

**动这几行之前想清楚**：加 `flex:1`、改 `justify-content` 都可能让内容再度被压缩。

### 2. 底部留白要按工具栏实测高度动态给

工具栏在窄屏会折行、展开二级菜单会变高，写死一个 padding 必然会在某个尺寸下遮挡内容。

```css
.slide{padding-bottom:calc(var(--pad-y) + var(--barh) + 6vh + env(safe-area-inset-bottom));}
```

`--barh` 由脚本实测写入（`syncBar()`，带 ResizeObserver）。工具栏宽度也由它按右下角
翻页区的实际位置收窄，避免按钮多了撞上去。

### 3. 每题「两题一页、中间留板书位」靠的是自动外边距

```css
.sinner.qpage.two .q:last-child{margin-top:auto;margin-bottom:auto;}
.sinner.qpage{min-height:100%;}
```

`min-height:100%` 是相对 `.slide` 的内容盒解析的，所以**打印时 `.slide` 必须给明确高度**，
否则这个百分比失效，第二题的位置会变。

---

## 二、打印导出（矢量 PDF）

### 1. `@page` 要用「命名页」逐页指定尺寸

每页内容高矮不同，用同一个 `@page` 尺寸要么裁切要么留大片白边。
CSS 命名页可以逐页贴合（已实测 Chrome/Edge 支持）：

```css
@page pgi3{size:1280px 979px;margin:0;}
.slide.pgi3{page:pgi3;height:979px!important;overflow:hidden!important;}
```

### 2. 样式表里已有的 `@media print` 必须被压住

`CSS` 末尾那套 `@media print` 是给「手按 Cmd+P」兜底用的（A4 重排、字号 11.5pt、
`.sinner.qpage{display:block}`）。点按钮导出时会注入另一份 `#printSheet`，
**所有规则都加了 `html` 前缀提高优先级**，否则会串版（字变 11.5pt、布局被重排）。

### 3. 行高必须用「无单位倍数」传递

`body{line-height:1.9}` 是倍率。如果把计算后的像素值（51.832px）写进打印样式，
它会**以固定长度**继承到小字号元素（眉题标签 font-size 15.3px），把行高撑到 51.8px，
整页内容被推下去 23px。

```js
var lhNum = parseFloat(bodyCS.lineHeight) / parseFloat(bodyCS.fontSize);   // 1.9
```

### 4. 别用 `display:none` 的元素量版面

同样读 `getComputedStyle`，隐藏元素拿到的是"计算值"而不是"使用值"。
量基准样式时从当前可见的那一页（`.slide.on`）读。

### 5. 清理要幂等

`preparePrint()` 开头先清掉上一次可能残留的 `#printSheet` / `svg.inkprint` / `pgi*` 类。
清理回调（`afterprint`）万一没触发，再点一次会叠加两份笔迹。

### 6. `print-color-adjust:exact`

不写这个，打印对话框里"背景图形"不勾选，答案框的米色底、标题色块全会丢。

---

## 三、手写层

### 1. 笔迹要按「页面内容坐标」存

`y = clientY + 当前页 scrollTop`。这样内容滚动时笔迹跟着走。
如果按视口坐标存，滚动时笔迹会钉在屏幕上不动。

### 2. 轮廓计算要缓存

perfect-freehand 算一次轮廓不便宜。`outlineOf()` 按 `points.length` 缓存，
canvas 绘制和打印 SVG 两条路径共用同一份结果。

### 3. 触屏双指 = 翻动内容

手写模式下 `touch-action:none`，单指写字意味着不能滑动。所以第二根手指按下的瞬间
取消当前笔画并进入拖动模式。

### 4. 触摸/触控笔：四个必踩的坑（iPad 实测）

**① 手掌压屏 → 笔写不出来**
旧逻辑把「第二支指针」一律当成双指拖动，Apple Pencil 一落纸就被取消。
现在按 `pointerType` 分流：`pen` 落纸接管一切（并作废手掌误起的那一笔），
`touch` 在有笔按下时直接忽略（掌拒）。

**② 手掌一直压着乱动 → 笔画被拉花**
旧逻辑 `pointermove` 里任何指针的移动都往 `stroking.points` 里塞点。
现在必须校验 `e.pointerId === strokePid`，只认正在书写的那一支。

**③ 写快了丢笔**
iOS 会把一帧内的多个采样合并成一个 `pointermove`，必须用
`e.getCoalescedEvents()` 把中间点全取回来（要 `try/catch` 兜住不支持的浏览器）。

**④ 快速书写划到边缘就断笔**
`pointerleave` 不能用来结束笔画——有 `setPointerCapture` 时 pointerup 一定会到，
而 pointerleave 会在划出元素边界时误触发。**只监听 pointerup / pointercancel。**

另有两条兜底：
- `pens` 用对象记录按下的笔（而不是布尔量），漏掉 `pointerup` 时不会永久卡在"笔在写"；
  切换手写模式时重置 `pens={}`。
- 在 canvas 上注册 `touchstart`/`touchmove`（`{passive:false}`）并 `preventDefault`，
  防止 iOS 把书写识别成滚动手势后掐断 pointer 流。

### 5. 写久了越来越卡：必须做「静态层 + 增量烘入」

症状很有迷惑性：**用 Apple Pencil 写久了卡，同一时刻用手指写却不卡**。
原因不是"笔的性能差"，而是两点叠加：
1. 手写笔采样率 240Hz，`getCoalescedEvents` 一帧能带来 4~8 个点，笔画点数是指尖的 3~4 倍；
2. 旧 `redraw()` 每帧把**所有**笔迹重填一遍 → 每帧开销 ∝ 笔迹总点数，越写越慢。
   指尖的笔画简单，所以同样的墨量下还能跑得动。

做法（缺一不可）：
- **静态层**：`stCv` 离屏画布存"已写完的笔迹"，每帧只需 `clearRect + drawImage(stCv)` + 画活动笔画；
  缓存 key = 页码 + 笔数 + 滚动位置 + 画布尺寸。
- **收笔增量烘入**：`pointerup` 时只把这一笔画进 `stCv` 并更新 key。
  **千万不要在这一步整页重烘**——那是 O(已有墨量)，表现就是"每写完一笔卡一下"（实测 120 笔时 12ms/次，iPad 上更久）。
- **采点降密**：间距小于 1.3px（橡皮 2.2px）就丢，抬笔那点强制补上。
  实测 1200 个原始采样只留 116 点，视觉无差别。
- **rAF 合并**：一帧只重绘一次，避免一帧内多个 pointermove 各画一遍。

改完必须验：两笔的墨量像素应正好是单笔的 2 倍（多了就是重复绘制）、橡皮有效、翻页不串页。

### 6. 复杂度：两个热点 + 一个内存陷阱

**时间热点 —— `curEl()`**
`pt()` 每采一个点都要取当前页元素，旧实现每次 `querySelector('.slide.on')` 全文档扫描。
手写笔 240Hz 下就是每秒 240 次 DOM 查询。必须加缓存（命中时 `classList.contains('on')` 校验，
失效自动重查），换页时置空。

**时间热点 —— 每帧的数组切片**
`redraw()` 里 `list.slice(0, list.length-1)` 每帧都分配一个新数组。改成只在缓存失效时才切。

**空间陷阱 —— 缓存随 页数 × 墨量 累积**
每笔保存 点数据 + Path2D + 轮廓数组 + SVG 字符串。其中**轮廓数组约占单笔 45%**，
构完 Path2D 就没用了，应立刻置空（打印时按需重算）。
另外 Path2D 缓存要「只保留当前页」：写满 19 页能堆到近百 MB，iPad 上会被系统杀后台。
做法是翻页时 `dropCaches()`——点数据才是唯一事实来源，回到该页按需重算即可。
翻页回来必须验证墨量像素与翻走前一致（缓存重建无损）。

### 7. 长按选中会打断手写

iPad/手机长按会弹「拷贝·查找·查询·翻译」并选中文字。手写模式下必须：
`body.hw, body.hw *{-webkit-user-select:none!important;user-select:none!important;-webkit-touch-callout:none!important}`
（`-webkit-touch-callout` 才是关掉系统菜单的关键），
再拦截 `selectstart`/`contextmenu`/`dragstart`。
**只在手写模式关**，退出后恢复，否则没法复制题干。

### 9. 改渲染器代码的标准流程

`render_deck.js` 是这套课件的心脏，动它之前按这个顺序来：

1. **先读本文档**（尤其第 4~6 节）；
2. **建版本快照**：复制一份 `render_deck.js` 到项目 `版本备份/<日期>-<改动摘要>/`，
   并在 `版本记录.md` 加一行。**不要先改后补**——出问题时要能立刻回退；
3. 改完跑 `node scripts/verify_deck.js <html>` 三项自检；
4. 涉及手写/渲染的，额外验：两笔像素 = 单笔 2 倍（无重复绘）、橡皮有效、翻页不串页、翻回后墨量一致；
5. 确认无误再重新生成课件。

历史版本演进（供参考，都踩过）：V2 长按选中 → V3 掌拒/断笔 → V4 分层渲染 → V5 复杂度优化（最终版）。

### 11. 加新 script 块 / 新 CSS 时的两个坑（V6 倒计时、V7 小插件都踩过）

1. **新 `<script>` 的闭合顺序**：写 `${open}${close}\n${open}` 是错的（会把上一个脚本提前截断，
   浏览器把两块当成一块，报 `Unexpected token '<'`，且**后一块仍能跑，肉眼看不出来**）。
   正确是 `${close}\n${open}`。改完必须 `node --check` + 自检。
2. **模块级常量不能引用只在函数内存在的变量**：`const X = (deck && ...)` 在模块作用域会
   ReferenceError，要写成 `function f(deck){...}`。
3. **大段 CSS 不要既插进 CSS 常量又 `${WIDGET_CSS}` 拼一遍**（会重复注入）。
4. **函数名要映射对**：`['plant','quiz'].forEach(w=>init(w))` 但函数叫 `initPlant/initQuiz` →
   运行期 `init is not defined`，整个 IIFE 静默死掉。用 `var INITS={plant:initPlant,...}`。

### 12. 橡皮在打印里用 `<mask>` 挖空

canvas 用 `destination-out`，SVG 没有这个操作，改成：白色矩形 + 黑色橡皮路径组成
`<mask>`，笔迹放在 `mask="url(#…)"` 的组里。

---

## 四、为什么没有位图导出

早期版本用 html2canvas + jsPDF 逐页截图拼 PDF，问题一堆且没有价值：

- 慢：html2canvas 每次截图都克隆整份文档，19 页要 168 秒（把其余页从 DOM 摘掉后能到 16 秒，但仍远慢于打印管线）
- 大：位图 PDF 1.77MB，矢量只要 400KB
- 糊：位图文字放大即糊，矢量可以无限放大

浏览器原生打印管线整章 **0.4 秒 / 400KB**，纯矢量。所以位图那套已整体移除
（连带 html2canvas 和 jsPDF 两个库，省了约 600KB）。

**不要重新引入**。真要一键出图而不弹对话框，先商量清楚代价。

---

## 五、改完必须跑的自检

```bash
node scripts/verify_deck.js <生成的.html>          # 需要 puppeteer-core（可选依赖）
```

它会用无头浏览器检查：
1. 每种视口下**内容不被左下角工具栏遮挡**（这是最容易回归的问题）
2. 打印准备是否正常（页数 = slide 数、无残留）
3. 手写笔迹在滚动后仍贴着内容

改 CSS、改打印逻辑、改手写坐标之后**都要跑一遍**。

## 六、`window.__onPage` 是全局单槽，谁都能覆盖它（2026-10-19 踩过）

翻页时主脚本调 `window.__onPage(cur)`，插件（plant/pace/focus…）和随机练习页都靠它挂钩子。
**新增挂钩子必须链式保留旧的**，直接 `window.__onPage = function(){...}` 会把别人的钩子静默清掉：

```js
// 错：直接把别人的钩子覆盖了
window.__onPage = function(i){ doSomething(i); };

// 对：先存旧的，再在自己的逻辑之后调它
(function(){
  var old = window.__onPage;
  window.__onPage = function(i){ doSomething(i); if(old) old(i); };
})();
```

手写层（`hwScript`）原来是硬覆盖写法，加随机练习页后练习页的钩子被吃掉，
表现是「练习页进去一片空白、题数 0」，但控制台一个错都不报——**极难查**。
已把三处（手写层、插件 `hookPage`、练习页）统一成链式。

排查这类「没报错但没生效」的问题，最快的办法是**在目标函数里插 `console.log`**，
用无头浏览器把 console 接出来看有没有执行，而不是反复读代码猜。

## 七、flex 容器里量「内容高度」不能靠 `scrollHeight`

`.prac-box` 用了 `flex:1 1 auto;min-height:0;overflow:hidden`（这样它的可视高度才由
剩余空间决定，而不是被内容撑开）。代价是 **`scrollHeight` 永远等于 flex 给它的高度**，
无论里面放1 道题还是 6 道题——用它判断「放不放得下」会永远得到放不下的结论。

正确做法是量最后一个子元素相对容器顶部的距离：

```js
var br = box.getBoundingClientRect(), lr = box.lastElementChild.getBoundingClientRect();
var contentH = Math.round(lr.bottom - br.top);
```

另一个相关的坑：`.sinner.prac>*{flex:0 0 auto}` 这条通用规则会把 `.prac-box` 的
`flex:1 1 auto` 覆盖掉（特异性 0,1,0 vs 0,0,1），导致盒高塌成 0。
需要写 `.sinner.prac>.prac-box{...}` 提高特异性。

## 八、练习页里高公式必须用 `vertical-align:middle`（2026-10-19）

MathJax 输出的 SVG 自带 `style="vertical-align:-2.5ex"` 这类负垂直对齐，用来让公式基线
和文字基线对齐。但遇到**分段函数、大分式**这种高公式时，行盒的基线会被拉得很低，
于是同一行里的文字（如「已知函数」）被顶到公式下方，整句话断成两截：

```
1              f(x)={x², x≤1; 2f(x-1), x>1}
    已知函数                  ，则 f(2)=（）
```

修法是给练习页里的公式改成中线对齐（**只作用于 `.prac-c`，不影响题目页**）：

```css
.prac-c .mx{vertical-align:middle;}
.prac-c .mx svg{vertical-align:middle!important;}
```

改完是连贯的一行：`已知函数 f(x)={...}，则 f(2)=（）`。
题目页没改——那边空间大、错位不明显，动它风险大（会影响全部已交付课件）。

排查手法：单独造一个**只含分段函数题**的小课件（题库 ≥3 道才会生成练习页），
复制两份、一份注入候选 CSS，同一视口各截一张图对比。比在完整课件里随机撞题高效得多。

---

## 九、右上角工具栏：窄屏藏文字 = 用户"看不到"（2026-10-19）

`@media (max-width:860px){.tmr .wbtn .tx{display:none}}` 这条规则是坑。
本意是省地方，实际效果是手机上只剩一个 **16×13px 的裸 emoji**，用户原话：
「这几个还在吗？我手机怎么看不到」——按钮其实一直在，只是小到认不出、也点不准。

改成窄屏**保留文字标签** + 点击热区抬到 32px 之后，代价是按钮会换行：

| 视口 | 工具栏 |
|---|---|
| ≥430px | 一行，高 32~34px |
| 390~430px | 五颗一行 + `换一批` 换到第二行（练习页），高 67px |
| ≤360px | 两行，高 67px |

所以**必须同时补顶部内边距**，否则内容会钻到工具栏底下：

```css
.slide-prac{padding-top:max(calc(var(--pad-y) + 8px), 56px);}  /* 宽屏兜底 */
@media (max-width:860px){ .slide-prac{padding-top:calc(var(--pad-y) + 78px);} }
@media (max-width:400px){ .slide:not(.slide-prac){padding-top:calc(var(--pad-y) + 66px);} }
```

**检测手法（关键）**：只比「工具栏 bottom vs 元素 top」会误判。`.prac-hd` 是全宽 flex 容器，
它的盒子横跨整页，但文字只在左边 60~370px 处。正确做法是拿 `Range` 取每个文本节点的矩形，
再和工具栏矩形做**二维相交**检测；13 档视口（320→1920）各测题目页/解答题页/练习页共 39 组。
改之前 900px 这一档就是这样漏出来的（文字右端 371 > 工具栏左缘 312，纵向重叠 4px）。


---

## 十、全屏按钮与字号上限（2026-10-21 从 l2html 移植）

**需求来源**：用户上课用电子白板，说「学习 l2html，增加全屏的功能」。

### 1. 为什么光加按钮不够，必须同时抬 `--u` 上限

浏览器**窗口化**时 `vmin` 只是窗口尺寸。老师把浏览器开成一半大小时，
即使点了全屏，`--u` 也只会从「半个屏幕的 vmin」跳到「整个屏幕的 vmin」。
原 cap 是 `clamp(17px, 2.4vmin+10px, 30px)`——**vmin 一超过 833px 字号就锁死在 30px**，
4K 白板上字只有物理尺寸的一小半。所以：

```
--u: clamp(17px, 2.4vmin + 10px, 46px);   /* cap 30px → 46px */
```

小屏完全不受影响（cap 只在 vmin>833px 后起作用）：1366×768 仍是 28.4px，
1920×1080 变 35.9px，3840×2160 到 46px。l2html 用的是 `1.9vmin+8px, 46px`，
q2html 保留自己的 `2.4vmin+10px`（原本就比 l2html 大，不往回改）。

**代价要说清楚**：字号变大 → 练习页一屏放不下那么多题（见 SKILL.md 的实测表）。
长题目课件掉得明显，短题课件基本无感。

### 2. 加一个按钮 = 工具栏变宽 = 要重测遮挡

`#bFs` 约 60px，7 颗按钮自然宽约 640px，而 `.tmr{max-width:min(94vw,620px)}`
会把它挤成两行、反过来压住练习页页眉（900/1024 两档就是这么挂的）。
把 max-width 抬到 `700px` 后，≥700px 视口恢复一行，620~700px 之间仍会换行
（≤860px 那条 `pad-y + 78px` 的规则覆盖得住）。

**结论**：往 `.tmr` 里加任何按钮，都必须重跑 14 档视口的「工具栏矩形 vs 真实文字矩形」检测。

### 3. 无头浏览器里两个骗人的坑（测试脚本层面）

- **`page.keyboard.press('Escape') 退不出全屏**。已用空白对照页验证：
  同一个键，`keyboard.press` 无效、CDP `Input.dispatchKeyEvent{type:'keyDown'}` 有效。
  浏览器自己的「Esc 退出全屏」挂在浏览器 UI 层，无头下合成事件到不了。
  → 测 Esc 必须走 CDP，否则会误判成「产品有 bug」。
- **l2html 那份同名测试的 Esc 用例是空转的**——它先按 F 退出全屏，再按 Esc，
  此时本来就不在全屏里，当然「通过」。抄测试用例时要看清时序。
- **进入全屏是异步的**。`__fsToggle()` 后立刻按 Esc 会被忽略，
  必须轮询等 `fullscreenElement` 置位。
- **抽问插件的人数输入框在 `.roll-over` 浮层里**，浮层 `display:none` 时 `focus()` 是空操作，
  测「输入框里按 F 不触发全屏」前必须先点「抽问」把浮层打开。
- **练习页题数必须翻过去才读**：`PRAC_SCRIPT` 是进入页面时才 `pick()`，
  没翻过就 `querySelectorAll('.prac-q')` 会得到 0，看起来像「练习页坏了」。

### 4. F 快捷键的避让

F 不在翻页脚本接管的方向键/空格之列，但要避开输入框（抽问有个人数输入框）
和 Ctrl/Meta/Alt 组合键，否则在输入框里打字会误触发全屏。

## 十一、内容缩放滑块 + 橡皮三档（2026-10-22，与 l2html 同一套方案）

用户需求：讲课投屏字太小，要一个**按钮 + 滑块**放大（明确不要 Ctrl+滚轮），
橡皮也要能调粗（一次擦掉更大面积）。实现要点与坑，详见
`l2html/references/pitfalls.md` 第 10 节；此处只记 q2html 侧的差异：

### 1. 挂载点与宽度

```css
:root{--z:1;}
.sinner{width:100%;zoom:var(--z);max-width:min(46em,100%);}   /* 不是 46em/var(--z) */
```

`calc(100% / var(--z))` 是错的：zoom 已按放大后可用宽解析百分比，再除一次会让
放大后内容反而收窄（实测 150% 时只剩 902px/1440）。`min(46em,100%)` 实测各档位
都正好铺满内容区且不横向溢出。

### 2. 打印复位 + 笔迹换算

`preparePrint()` 开头 `--z=1` 并 `window.__inkRescale(1/z)`，cleanup 恢复；
打印隐藏列表加 `html .zoom-panel`。顺带把 `window.__preparePrint = preparePrint` 暴露出来
（原来只有 l2html 暴露，导致 q2html 的 zoom_test 第⑥项跑不了）。

### 3. 橡皮三档

`ER=[14,26,44]`，点橡皮进模式、再点循环；**每笔在 beginStroke 时记录 `size`**，
`outlineOf` 改为一律用 `s.size`（原来是 `s.tool==='eraser'?eraserSize:s.size`，
全局量一变旧笔迹全变形）。

### 4. 方向键归属

翻页 keydown 原来不判焦点，滑块聚焦后方向键会边调滑块边翻页。改成
`INPUT/TEXTAREA/SELECT/contentEditable` 先 return（空格仍只避让 BUTTON）。

### 5. 加按钮必须重测工具栏

`.tmr` 里多一颗 `#bZoom`。检测要用**文字 Range 矩形**（元素盒子会假阳性：
`.runt` 课时标题行盒子含右侧留白）。实测 10 档视口（390→1920）文字均不压工具栏，
200% 缩放无横向溢出；回归：`node scripts/zoom_test.js <html>`（19 项）。
