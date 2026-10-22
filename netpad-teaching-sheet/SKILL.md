---
name: netpad-teaching-sheet
description: "为某道题做网络画板（netpad.net.cn）教学素材——2D 分步活页、3D 立体几何素材，或用 HTML 做同一个题的分步课件。当用户说『用网络画板做一下这道题的活页』『做 2D 活页/课件』『把这道题做成网络画板分步演示』『用 3D 画一下这道题』『直接用 HTML 生成展示』时使用。产出 = 可直接整段粘贴到每个画板的指令代码（含『下一个』动作按钮）+ 板书文稿 + 手工操作对照表；3D 版另附可放大的坐标方案与预览图；或一份零依赖的单文件 HTML 分步课件（含打印版 PDF 与单页 PNG）。"
agent_created: true
---

# 网络画板教学活页（netpad-teaching-sheet）

## 核心原则（用户已明确表态，务必遵守）

1. **一页 = 一步解析，板书式。** 用户否掉了"坐标系上的拖动探索"路线，原话：**"我不要坐标系上的动画，要的是一步一步出步骤，你把解析一条一条提出即可"**。
   - 所以：**不要**用 Slider 拖参数、不要 Animation 让参数自己动。
   - 页序固定为：题目 → 步骤① → 步骤② → … → 答案与方法小结。
   - 纯题目页**故意不画曲线**（形状待求，画了等于泄题）。
2. **图形用确定的表达式画。** 参数都代成最终值（如 a=-4、b=3），用 `YCurve('expr','min','max','200',{stepNum:'10'})`。
   `Reflect` / `Translate` 只写成注释备用（无法在用户账号实跑，表达式版本零风险）。
3. **每页都要"板书文稿"**（markdown 块），代码块只放能跑的东西。
4. **每页结论必须数值自检过**。曾凭记忆写错（f(0) 记成 3，实际 1，因为基底式只在题给区间成立）。写图之前先跑 Python 验：接缝是否等值、左右导数是否相同、关键点函数值。

## 输入与环境

- 用户的网络画板指令表：`/Users/cc/Downloads/网络画板指令（表格）.xlsx`（27 个子表）
  - **读法（关键坑）**：列布局 c0 指令名 | c1 对应ggb | c2 中文名 | c3 用法 | c4 返回类型 | c5 描述 | c6 对应接口 | c7 说明 | **c8 举例-输入（真实可运行代码）**。**只有 c8 是能跑的代码**，前面几列大多是空的。
  - 读表用 sheetagent：`resolve_local_excel` → `read_table`。要点子表：`00001a` 操作性指令、`000018` 公共-构造更多（Slider/Animation/Action/ActionShowHide/Text/Express 都在这）、`000005` 2D-函数曲线、`000008` 2D-变换、`000009` 2D-测量、`00001b` 网络画板暂无（**别用这些**）。
- 题目来源可能是 PDF：`pymupdf`（venv `/Users/cc/.workbuddy/binaries/python/envs/default/bin/python`），公式题 `get_text()` 不可用，要 `page.get_pixmap(dpi=420, clip=Rect(...))` 渲染裁剪后读图。

## 常用指令（已核对的写法）

```
Slider("a",{value:-4,min:"-6",max:"2",step:1})                 // 变量滑杆
Point(1,0)                                                     // 自由点
RightPoint('x0','x0^2+a*x0+b')                                 // 表达式点（可引用变量）
YCurve('x^2-4*x+3','1.5','3','200',{stepNum:'10'})             // 函数曲线
Segment(A,B) / Straight(A,B)
Reflect(e,点或线) / Translate(e,dx,dy) / Rotate / Dilate
Text("…") / Express('2*a+8')
MeasureCoorY(P) / MeasureCoorX(P) / MeasureRightCoor(P) / MeasureDistance(P1,P2) / MeasureLength(e)
hideElements([...]) / showElements([...]) / showLabels / hideLabels
updateStrokeByIds([C1],{opacity:1,Stringwidth:4})              // 线型；注意字段名是 Stringwidth
updatePointSize([P],4)
setDataValue({'a':-4,'b':3})                                   // 一次性赋值（值，不接表达式自增）
Animation('名',[{varName:'a',s:'0',e:'4',num:'4',timer:10}],'0','1','5')   // 动画按钮
Action([...],{btnType:0|1, driveType:0时间|1手动, timeVal:…})    // 动作按钮
ActionShowHide([...])                                          // 快捷显隐按钮
```
- **默认坐标系 id：2 = x 轴，3 = y 轴**。
- **指令表里没有"视图/缩放"类指令** → 画面大小位置只能手动滚轮缩放 + 拖动平移。

## 「下一个」按钮（分步揭示，重点）

**能做，是原生功能。** 官方文档 + 教程实证：

### 界面做法（推荐，绕开猜字段名）
1. 「变量」工具建变量 `a`（min 0、max 5、**增量 1**；滑杆可用属性表单隐藏）。
2. **什么都不选中** → 点「动作|显隐」工具 → 弹动作对话框。
3. 基本设置：驱动方式选**手动驱动**，播放方式选**串行**，按钮描述填 **"下一个"**。
4. 动作设置 → `+` → 动作类型选「**设置变量**」→ 变量名 `a` → **变量值 `a+1`**（**支持表达式**）。
5. 边界保护：变量值改 `if(a<4,a+1,4)`（官方教程里就用 `if(n-1>3,n-1,3)`）。
6. 再做一个「重置」按钮：设置变量 `a=0`。

### 为什么按钮自带"报幕"效果
官方行为：动作按钮上有提示信息、**动作数量**、**播放进度**（矩形条：蓝=已执行、绿=下一步、白=未执行），且**按钮文本显示的是"下一步要执行的动作"**。
→ 把每个动作的 `description` 写成"① 周期 T=4""② 中心对称"……按钮上就直接显示下一步干什么。

### 两种形态
| 形态 | 动作类型 | 适合 |
|---|---|---|
| 设置变量型 | 设置变量 `a=a+1` | 参数连续变化（点一下画面跟着变） |
| **显隐型（做"一步一步出步骤"最贴）** | 一串「显示」动作 | 板书逐步揭示（点一下多出一行推理） |

代码骨架：`Action([{name:'show',destObjs:[...],description:'① …'}, …],{btnType:1,driveType:1,timeVal:1,description:'下一个'})`
- 表里**只给了 `'show'` 一个 name 样例**（`{name:'show',destObjs:[5],description:'显示'}`）；"设置变量"对应的 name 表里没写（猜 `'setDataValue'`/`'setValue'`，未验证）→ **建议直接界面点**。

## 交付物形态

一份 md：`outputs/网络画板_<题号>_2D活页指令.md`
- 开头写"怎么落地"（工作台→新建→活页→新增素材→整段粘贴→保存→放映）+ **粘贴注意**（同页变量名别重名、视图手动调、Text 落点手动拖、`//` 注释行报错就删）
- 每页：讲什么 → 版面上有什么 → 代码块 → 板书文稿 → 课堂用法
- 附录：A 手工操作对照表（指令 → 界面点法）、B「下一个」按钮专章、C 指向其余题目的详解文档
- 结尾"需要确认的点"要如实列出未验证项（Reflect 作用于函数曲线、Express 落点、hideElements 传变量名）

## 备用路线：单文件 HTML 分步课件（用户会主动要求，先说结论）

**网络画板不接收 HTML。** 已全表核实：指令表里搜 `网页`/`嵌入`/`链接` 均 0 命中，能引外部资源的只有 `Picture(url)` 和 `Audio(url)`。它是自己的指令语言，不是网页容器。
→ 若用户要"HTML 展示"，就**直接做一份独立 HTML 课件**；想进画板再把 HTML 导出 **PDF/PNG**，用界面上的「图片」工具上传为素材。

**HTML 课件的设计规范（已验证好用）**：
- 单文件、**零外部依赖**（不放 KaTeX/MathJax CDN，公式用 `Times` 斜体 + `<sup>`，断网也能跑）；图形用**内联 SVG polyline**，坐标由 Python 按真实表达式算出来
- 16:9 舞台（`.stage{aspect-ratio:16/9}`），每页 `<section class="slide">`，靠 `.active` 切换
- **分步揭示**：给要逐步出现的元素加 class `rv` + `data-hint="这一步要干什么"`；JS 每次点击把当前页第一个未显示的 `.rv` 打开，本页讲完再翻页
- **「下一个」按钮复刻网络画板动作按钮的"报幕"行为**：按钮文字 = `下一个 · ` + 下一个 `.rv` 的 data-hint，右下角显示"本页还剩 N 步"
- 键盘：`→/空格/回车/PageDown` 下一步、`←/PageUp` 上一步、`Home` 重置 → **翻页笔直接可用**；另加点击画布前进、深浅色切换按钮（`:root` / `body.dark` 两套 CSS 变量）
- **打印即讲义**：`@media print` 里写 `@page{size:13.333in 7.5in;margin:0}`、每页 `page-break-after:always`、`.rv{opacity:1!important}` 强制显示所有步骤、隐藏控制条
- **viewBox 别留白**：内容若集中在中间，统一裁成紧致的 viewBox（如 `viewBox="14 12 166 86"`），否则图会显得很小

**验收手法（强烈推荐，别盲写）**：写完后用 Edge 无头打 PDF，再用 PyMuPDF 把每页 `show_pdf_page` 拼成一张 contact sheet PNG，用 Read 看图核对版面。命令：
```
"/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge" --headless=new --no-sandbox \
  --disable-gpu --no-pdf-header-footer --print-to-pdf=out.pdf "file://$PWD/xxx.html"
```
再用 `fitz` 渲染单页 PNG（`matrix=Matrix(2,2)` → 1920×1080）作为可上传进画板的图片素材。

## 画布背景色（指令表里没有，只能在界面改）

**指令层面没有背景/主题类指令**（操作性指令子表 00001a 全部 24 行已扫完；2D-坐标系子表只有 `UCSAxis`；搜 `背景`/`canvas` 均 0 命中）。所以只能走界面：

- **2D 编辑器**：右侧「**属性**」面板 →「**全局**」→「**基础**」→「**画布颜色**」（同一处还有「画布尺寸」1:1 / 4:3 / 16:9…、「箭头样式」、「**背景图片**」）
- **顶部菜单「设置」→「系统预设主题」/「更多主题…」**：改的是**默认**画布颜色——新建素材时就生效，想统一整个课件的底色走这条
- **3D 编辑器**：官方 3D 手册原文——「画布的**默认颜色为黑色**，可在【**全局属性/基础/画布颜色**】调整画布颜色，可通过【主题】自定义默认画布颜色」
- **活页的每一页是独立素材，背景要一页一页单独设**；想省事就先改「系统预设主题」再建素材
- 导出「高清图片(.png/.pdf/.svg)」会带上画布颜色 → **要白底图就把画布先设成白色再导出**

## 3D 素材（立体几何题）

> **用户已确认的标准做法（2026-09-21 原话："很好，以后 3D 图像就这么做"）。以后凡是立体几何图，默认按本节执行，不要再问。**

指令入口：3D 编辑器 → 顶部菜单「**指令作图**」。**先改画布颜色为白色**（3D 默认黑底）。

3D 常用指令（已核对写法，来自子表 00000a~000012）：

| 用途 | 指令 |
|---|---|
| 点（可写表达式） | `RightPoint('x','y','z')`；`Point(x,y,z)` 只收数字 |
| 球面点 | `OnSpherePoint(球id, dx, dy)` |
| 四点定球 / 三点定球 | `CircumsphereBy4Points(A,B,C,D)` / `CircumsphereBy3Points` |
| 球（球心+法向） | `SphereByCentreNormal(点, 带法向元素)`（**半径不可指定**，要可控半径就用四点定球） |
| 平面 | `PlaneBy3Points(A,B,C)`、`ParaPlane`、`VertiPlaneBy2Geo/3Geo`、`MidPlane` |
| 圆 | `CircleByPointAxis(轴直线, 圆上一点)`、`CircleByCentreNormal(圆心, 法向, 半径)` |
| **相贯线** | `IntersectingLine(平面, 球)` → 截面圆（把平面/平面、平面/实体都算进去） |
| 线 | `Straight/Ray/Segment`、`VertiLine(点, 平面)` 过点作平面的垂线、`ParaLine` |
| 投影 | `Projection(元素, 线或平面, ratio)` |
| 标注/测量 | `AngleLabel(p1,p2,p3)`（**p2 是顶点**）、`LineLabel`、`MeasureDistance(p1,p2)`、`MeasureLength`、`MeasureRadius`、`MeasureCoorZ`、`MeasureVector`、`MeasureVolume` |

**立体几何题的建模套路（第 14 题实证好用）**：把题目给的**对称面取成 z=0 平面、对称中心取成原点**，其余点用 `RightPoint` 写**精确根式表达式**（如 `'sqrt(5/3)'`），这样所有条件精确成立，不用凑数。摆好之后**用测量指令把关键长度念出来**——数值一出来题目就落地了。
风险点：`RightPoint` 里的 `sqrt()` 若不被识别，换小数；`IntersectingLine(平面,球)` 未实测，兜底用 `CircleByPointAxis(Straight(O,D), A)`。

**预览图做法（推荐）**：用 numpy 写个正交投影（azimuth+elevation）把三维点投到平面，生成 SVG → Edge 无头 `--screenshot --force-device-scale-factor=2` 出 2× PNG → 用 Read 看图核对。
- **坑：Edge 无头截 SVG 时路径不能带中文**——直接 `file://` + 中文文件名会截到一张 `ERR_FILE_NOT_FOUND` 的错误页（而且它照样写出一张几百 KB 的 PNG，不看图根本发现不了）。**先 `cp` 到 `/tmp/xxx/p14.svg` 这类纯 ASCII 路径再截，截完再改回中文名拷回 outputs**。生成后必须用 Read 真的看一眼。
- **视角选仰角 15~20°**：太大（≥26°）会让"截面外的点"看起来落在截面圆里面，破坏"三点共线"的读图直觉
- 正交投影下**球的轮廓是以球心投影为圆心、半径 R 的圆**，直接用 `<circle>` 画即可
- 标签位置**按"背离所有点质心"的方向自动偏移**，比手调偏移量省事且不重叠
- **验收要验到数**：检查 A/B/C 是否落在截面圆投影的椭圆上（解 `[e1 e2] t = q`，验 `|t|=1`）、O/O′/D 的屏幕坐标是否共线（横坐标之差 ≈ 0）

## 收尾
- 走网络画板路线时：用 read_me(diagram/mockup) + show_widget 做一张**多页预览图**（用 Python 按真实表达式生成 polyline 坐标，逐页一张小图 + caption），让用户在粘进画板前先确认版式；再用 present_files 交付 md。
- 走 HTML 路线时：先按上面"验收手法"渲染 contact sheet 看图改版面，再把 **HTML 放第一个** present_files（会自动开预览面板），后面跟打印版 PDF 和单页 PNG。
