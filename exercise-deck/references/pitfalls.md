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

### 4. 橡皮在打印里用 `<mask>` 挖空

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
