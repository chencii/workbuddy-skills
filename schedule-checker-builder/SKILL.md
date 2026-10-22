---
name: schedule-checker-builder
version: 1.0.0
agent_created: true
display_name: "课表检查器生成"
display_name_en: "Schedule Checker Builder"
description: 从「班级课表 xlsx + 教师名单 xlsx」生成单文件交互式课表检查器 HTML——选教师一键高亮(#A9BA9D)、【修改】模式下拖拽任意格子换位并自动检查全部硬约束（违规拒绝/合法对调）、全量硬约束检查按钮。当用户要求"生成课表检查器"、"课表 HTML 展示"、"教师高亮工具"、"拖拽换位检查约束"、"排课结果做成网页供检查/发布"等场景时使用。输入排课模型的输出底表（每班一个 sheet 的 xlsx）与教师安排表，输出浏览器即用的自包含 HTML。
---

# 课表检查器生成（schedule-checker-builder）

把「排课模型输出的班级课表 xlsx + 教师名单 xlsx」一键转成**单文件交互式课表检查器 HTML**：
浏览器打开即用，无需任何依赖，可单独转发或部署成公网网站。

## 产物功能

1. **教师一键高亮**：下拉选教师 → 该教师全部课节变绿（#A9BA9D）+ 顶部显示周课表摘要（每天几节/哪些时段）
2. **拖拽换位 + 硬约束自动检查**：【修改】↔【保存】按钮切换；编辑模式下拖拽任意格子到另一格，交换前自动跑**全部硬约束**——违反则拒绝（提示具体违规约束），合法则两格内容对调
3. **检查硬约束按钮**：随时全量检查，违规格子红框 + 底部违规清单
4. 锁定格（早读/夜自习/班会/公共自习）不可拖拽

内置硬约束检查（与排课模型一致）：锁定/早读绑定/课时总量+正课自习槽位分离/教师冲突/连排恰1对/两班连排同日同半天/语数外半天制/语文分布/英语每天1节/数学分布/小科每天≤1/体育限制/小科不排前两节/语英错峰/物理4+1+周四1节+无课日一致/数学老师半天制/教师特定时段约束。

## 输入文件格式

- **课表 xlsx**：每个班级一个 sheet（sheet 名=班级号，如 `2601`）；每 sheet 行 5 起为 13 个时段（早读、第1节、第2节、学科自习、第4~9节、晚自习1、晚自习2、夜自习），列 3-7 为周一~周五；格子内容 `科目\n教师`（早读格为 `早读·语文` 样式）
- **教师名单 xlsx**：含"科目"表头行（科目 列 × 班级 列），含"班主任"行、"班型"行

## 用法

```bash
# 一键出网站（推荐）：只给课表，自动提取教师 → 生成检查器 + 部署目录
python3 scripts/build_checker.py \
  --schedule 课表.xlsx \
  --out 输出目录 \
  --title "高一全周课表检查器" \
  --deploy-dir 网站部署目录 \
  --verify

# 带教师名单（有班主任★标记）
python3 scripts/build_checker.py \
  --schedule 课表.xlsx \
  --teachers 教师名单.xlsx \
  --out 输出目录 \
  --title "高一全周课表检查器" \
  --verify

# 自定义课时需求（不同年级课时不同时）
python3 scripts/build_checker.py --schedule ... --teachers ... --out ... \
  --hours '{"语文":[5,2],"数学":[6,3],"英语":[5,2],"物理":[4,1],"化学":[3,2],"生物":[3,2],"政治":[2,1],"历史":[2,2],"地理":[2,2],"体育":[2,0],"艺术":[1,0],"信息/心理":[1,0]}'
```

参数：
- `--schedule`：必填，课表 xlsx（每班一个 sheet）
- `--teachers`：**可选**——不提供则从课表自动提取教师列表（63 人照常显示/高亮/拖拽拦截，仅无班主任★标记）
- `--out`：输出目录（默认当前目录），产物 `index.html`（单文件检查器）+ `test_checker.html`（自动测试页）
- `--deploy-dir`：可选，把 index.html 复制到该目录，作为网站发布源（配合 cloudstudio-deploy）
- `--title`：页面标题；`--hours`：课时需求 JSON（默认内置高一配置）
- `--verify`：用 Edge headless 自动验证（初始 0 违规 + 冲突检出）
- `--edge`：Edge 路径（默认 macOS 标准路径）

### 一键出网站完整流程（agent 工作流）

1. 运行 `build_checker.py --schedule 课表.xlsx --out <out> --deploy-dir <site> --verify`
2. 若 `--verify` 通过（初始 0 违规），加载 **cloudstudio-deploy** skill
3. 调用 `workbuddy_cloudstudio_deploy` 部署 `<site>` 目录（含 index.html）
4. 把返回的 **分享链接** 给用户（此后课表更新只需重跑 build_checker.py + 重新部署同一目录）
5. 下线管理：用户可在「设置 - 数据管理 - 我发布的应用」操作

## 技术要点（改代码前必读）

1. **槽位模型（v21）**：第3节/晚自习1/晚自习2 固定自习位；周二(1)、周五(4) 第8/9节为"动态位"（一自习一正课）；周一(0)第9=班会、周三(2)第9=公共自习、周四(3)第8/9=正课位、周一三第8=正课位。不同学校课表结构不同需改 `fixed_lt`。
2. **动态位判定**：外部无法直接知道二五8/9哪格是自习位 → 用**暴力枚举**（每班 4 个动态格 16 组合，选使每科正课/自习精确匹配需求且二五每天恰 1 个自习位的组合），见 `resolve_dyn`。若某班解析失败说明课表本身槽位不平衡。
3. **连排检查**必须用 `lt`（正课位标记）判断 (7,8) 是否算连排（第8节是正课位才算）。
4. **教师特定时段约束（引擎内 C6-C12 区块）**：按年级/需求硬编码教师名（如王艳萍四五不排第1节）。新年级不需要可删除该 JS 区块；**这些约束不在页面显示**（避免对外暴露内部安排），仅在拖拽拦截时生效。
5. 生成器自包含（模板内嵌在 `build_checker.py`），无外部依赖除 openpyxl。

## 验证与发布

- **自动验证**：`--verify` 跑 test_checker.html（T0 初始0违规 / T1 教师冲突检出+还原）。Edge headless 命令：
  `"/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge" --headless=new --no-sandbox --disable-gpu --dump-dom file://.../test_checker.html`
- **发布成网站**：用 cloudstudio-deploy skill 部署包含 index.html 的目录，生成公网分享链接；更新后重新部署即可。
- **本地预览**：直接把 index.html 用浏览器打开。

## 复现记录（2026-08-26 固化）

来源项目：阳泉一中 2026 秋季高一排课（workspace mt7cq04avyu4ocg3），v26 课表。原生成脚本 `build_checker_html.py`（数据+引擎）+ `build_checker_ui.py`（UI+测试页）已合并参数化为本 skill 的 `scripts/build_checker.py`。
