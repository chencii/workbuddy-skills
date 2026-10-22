---
name: l2html
description: L2HTML —— 把「教师版学案」做成单文件 HTML 新授课课件（Lesson → HTML，与 q2html 的「题目 → HTML」同构：q2html 出习题课件，l2html 出授课课件）。输入为 Word(.docx)/PDF/文本的学案，先转成结构化 content.js（只排版、不增添学案之外的任何内容），一条命令渲染出自包含 HTML——封面+可点击目录、按环节分页、定义卡/提示卡/三线表/例题卡/折叠答案、板书演算空白区、左下角手写批注、右上角倒计时、一键导出矢量 PDF。触发词：L2HTML、l2html、新授课课件、学案做课件、把学案做成网页/HTML、教师版学案转课件、新授课翻页课件、授课课件生成、课堂授课 HTML、Lesson2HTML。
agent_created: true
---

# L2HTML · 新授课课件生成（学案 → 单文件 HTML）

把一节课的教师版学案，做成能直接投影、能手写批注、能导出 PDF 的网页课件。
命名与 q2html 同构：**L = Lesson（课时/学案）→ HTML**；q2html 管「题目+答案」的习题课件，
本技能管「按学案环节走」的新授课课件。

## 核心原则（红线）

1. **内容严格取自学案，只做排版**：不新增情境、分析、小结等学案之外的内容。
   要留讲授空间就用 `board` 块（板书演算空白区）或学案原有填空。
2. 学案的知识点顺序即页面顺序，不重排教学逻辑。
3. **题和答案必须在同一页**：例题/跟踪题的解答用折叠的 `ans` 块放在题目下方
   （q2html 的「答案折叠」模式），**禁止**把题排一页、解答排到下一页，
   更禁止把上一题的解答和下一题型的内容混在一页。
4. **下方留位置，不要卡死**：每页内容不排满，题页尾部放 `board` 板书位；
   一页只放一个教学单元（一个题型讲解 / 一道例题 / 一道跟踪题），
   学案里连续的「例+跟踪」可同页但答案合并折叠。

## 工作流（三步）

### 1. 把学案转成「课时文本」

| 来源 | 做法 |
|---|---|
| Word (.docx) | `python3 scripts/docx_to_text.py 学案.docx -o 学案.txt`（OMML 公式自动转 LaTeX） |
| PDF | `python3 scripts/pdf_to_lesson.py 学案.pdf -o 学案.txt`；扫描件先用 `wpscli` 转 Word 或 `glmocr-formula` OCR |
| 纯文本/网页 | 直接整理 |

### 2. 把课时文本写成 content.js

**数据结构见 `references/schema.md`**（页面字段、全部块类型、行内语法、figs.js）。
最快的上手方式：**照抄 `assets/example/`**——那是一节完整的《函数的单调性》新授课
（content.js + figs.js），26 页，覆盖 def/note/tbl/steps/ex/dt/num/sub/opts/sol/solf/dtab/board/grid/ans/hint/qa/exa/q 等全部常用块。

要点：
- 封面必须是 `PAGES[0]`，`toc` 键「一/二/三…」与内容页 `tag` 开头中文数字一一对应
- **`tag` 格式必须是 `一 · 环节名`**（目录跳转靠它，写错目录全废，见 pitfalls 第 1 节）
- 公式写 LaTeX（`$...$` / `$$...$$`），填空用 `{{b}}`，构建期转 SVG
- **分页粒度**：一个教学单元一页；例题/跟踪题的解答一律 `ans` 折叠块与题同页
  （见核心原则 3、4）；`assets/example/` 的「七 · 课堂展示交流」9 页是标准分页范例

### 3. 一条命令生成 HTML + 自检

```bash
node scripts/render.js <content.js> [figs.js] [out.html]
```

`figs.js` 可省（无图课件）；`out.html` 默认写到 content.js 同目录的 `新授课课件.html`。
脚本打印页数与体积，然后**必须**跑自检三件套（见下），全过才交付。

## 输出课件里有什么

- **封面 + 可点击目录**：目录按环节两栏排布，点击直达该环节第一页；底部「人教A版」式落款
- **页眉体系**：环节标签（`一 · 学习目标`）+ 页面标题 + 建议时长，右上角计时器
- **学案原样排版**：定义卡、提示卡（要点/点拨/警示三色）、三线表、例题/跟踪题卡、折叠答案与提示、板书演算空白区
- **✎ 手写**：黑笔/红笔/橡皮/清本页/清全部；笔迹按页面内容坐标存储，跟着内容滚动走
- **橡皮可调粗细（三档）**：点「橡皮」进擦除模式，**再点循环 细(14px)→中(26px)→粗(44px)**，按钮实时显示当前档（橡皮·中）；每笔自带擦除尺寸，换档不会让已擦的笔迹变形。大橡皮一次能擦掉一整片，不用来回蹭
- **放大/缩小滑块（右上角 Aa）**：点开拖滑块 80%~200%（或 −/＋ 按钮、键盘 `+` `−` `0`），只放大页面内容、工具栏和页码不动；放大后内容宽度自动锁在视口内，只往下滚。**明确不用 Ctrl+滚轮缩放**（课堂易误触）；导出 PDF 时自动按 100% 输出，不受放大状态影响
- **打印/存PDF（矢量）**：浏览器原生打印管线，屏幕同款逐页精确纸张，文字可选中、手写批注一起导出；用户在打印对话框选「存储为 PDF」
- **⛶ 全屏（右上角，快捷键 F）**：一键全屏；字号随屏幕短边（vmin）同步缩放，1080p 正文 28.5px、4K 电子白板 46px，全班看得清。手机上自动隐藏（iOS 不支持元素全屏）
- **逐步揭示（可选）**：块加 `rv: true` 后，页面底部出「下一步 n / N」条，空格/点击推进
- **多设备**：手机/平板/投影自适应；右下翻页（按钮+键盘方向键/PageUp/Down/Home/End）

## 脚本一览

| 脚本 | 作用 |
|---|---|
| `scripts/render.js` | content.js [+ figs.js] → 单文件 HTML（含手写层、计时器、打印导出） |
| `scripts/verify.js` | 结构自检：页数/页码/折叠/打印规则/逐页内容溢出/控制台报错 |
| `scripts/toc_check.js` | 目录逐条点击实测 + 「回到首页」按钮（防目录跳错页回归） |
| `scripts/shot.js` | 逐页截图（`node shot.js <html> <outdir>`），人眼抽检版式 |
| `scripts/pdftest.js` | 无头浏览器直接产 PDF（`node pdftest.js <html> out.pdf`） |
| `scripts/fs_font_test.js` | 全屏按钮 + 字号随屏幕缩放实测（三种视口量字号/查溢出 + 点击/F/Esc 行为） |
| `scripts/zoom_test.js` | 内容缩放滑块 + 橡皮三档实测（19 项：--z/宽度不溢出/按钮与键盘/橡皮循环/打印复位） |
| `scripts/docx_to_text.py` | Word(.docx) → 文本（公式转 LaTeX） |
| `scripts/pdf_to_lesson.py` | PDF → 文本（文字层+公式图按阅读序合并） |
| `scripts/client/deck.js` | 翻页/逐步揭示/计时/页码（渲染时内联） |
| `scripts/client/hw.js` | 手写层 + 打印导出准备（渲染时内联） |

**改渲染器前必读 `references/pitfalls.md`**（目录跳转索引基准、角落控件标准文案、
打印机制、本机 grep 中文假阴性等坑）。

依赖：Node 侧 `mathjax-full`、`perfect-freehand`（渲染用），`puppeteer-core`（自检用）。
解析顺序 `L2H_DEPS` > 本技能 `.deps/` > 复用 q2html 技能的 `.deps/`；三者都没有时
在本技能目录 `npm install mathjax-full perfect-freehand puppeteer-core` 装入 `.deps/`。
浏览器用本机 Microsoft Edge headless（macOS 路径见 pitfalls 第 5 节）。

## 交付前的检查清单

- [ ] content.js 每页 `tag` 都是 `中文数字 · 名称` 格式，且目录每条都有对应内容页
- [ ] **一页一个教学单元；每道例题/跟踪题的解答都与题同页且为折叠 `ans` 块**（无题答分离、无混页）
- [ ] 通读一遍成品：没有学案之外的自拟内容；学案填空/思考题原样保留
- [ ] `node scripts/verify.js <html>`：`contentOverflow` 为空、`errors` 为空
- [ ] `node scripts/toc_check.js <html>`：目录逐条全过 + 回到首页通过
- [ ] `node scripts/shot.js <html> shots`：抽 2~3 页截图眼看版式（尤其有图/有表的页），确认页面下部有留白/板书位
- [ ] 上课要用大屏/电子白板时：`node scripts/fs_font_test.js <html>` 过一遍（三种视口字号 + 全屏按钮行为），并提醒用户先点右上角「全屏」
- [ ] 动过缩放/橡皮/手写层：`node scripts/zoom_test.js <html>` 全过（缩放面板/宽度不溢出/橡皮三档/打印复位）
- [ ] `present_files` 打开给用户看
