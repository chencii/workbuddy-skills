---
name: schedule-from-scratch
description: "从零生成高中全年级课表（OR-Tools CP-SAT 求解）。当用户给出教师任课安排表、要求『从零排课/重新排课/生成课表』时使用。含 44 项硬约束 + 15 项软约束的完整约束体系、全局求解、全量验证与交付链路。"
agent_created: true
---

# 从零排课（schedule-from-scratch）

## Overview

输入任课老师安排表，用 OR-Tools CP-SAT 求解器从零生成 18 个班（2601-2618）的全周课表。这是排课流水线的第一步。

## 环境与路径

- 工作区：`/Users/cc/.qwenworkcn/workspace/mt7cq04avyu4ocg3/`
- Python：`/Users/cc/.workbuddy/binaries/python/envs/default/bin/python`
- 输入：`uploads/教师安排表_重建.xlsx`（含班级、科目、任课老师、班主任、班型）
- 核心脚本：`schedule_maker.py`（建模，44硬+15软）、`solve_global.py`（全局带软目标求解）、`check_final.py`（18项硬检）、`audit_all.py`（44项全量审查）、`diag_compact.py`（紧凑度诊断）、`build_merged_table.py`、`build_checker_html.py`

## 操作步骤

1. **确认输入**：检查 `uploads/教师安排表_重建.xlsx` 是否为最新（班级/科目/老师映射）。
2. **全局求解**（约 8-10 分钟，4 workers）：
   ```bash
   cd /Users/cc/.qwenworkcn/workspace/mt7cq04avyu4ocg3
   MAX_T=600 W21=30 python solve_global.py output/全年级课表_v<新版号>.xlsx
   ```
   求解器会自动决定 worker 数（可用内存小则 4）。产出 `FEASIBLE` 即合格（`OPTIMAL` 更好）。
3. **全量验证**（必须全部通过）：
   ```bash
   python check_final.py        # 18 项硬约束，输出「✓ 18 项通过」
   python audit_all.py          # 44 项硬约束 + 15 项软约束达成度
   python diag_compact.py outputs/全年级课表_2026秋季.xlsx  # 间隔/晚自习连贯/跨半天
   ```
4. **更新交付物**：
   ```bash
   cp output/全年级课表_v<新版号>.xlsx outputs/全年级课表_2026秋季.xlsx
   python build_merged_table.py          # 生成合并大表
   python build_checker_html.py          # 生成 data.js/check_engine.js
   ```
   然后更新 `website/index.html`：**只替换 `var SCHED_DATA = ` 那一行**（用 `outputs/checker/data.js` 里的新行），不要整体重建（会丢已验证的 UI 逻辑），再 `cp website/index.html outputs/全周课表检查器.html`。
5. **部署**：调用 workbuddy_cloudstudio_deploy 部署 `website/` 目录。
6. **汇报**：给用户对比关键指标（跨半天人次、间隔、晚自习连贯、S12 等）+ 硬约束全过结论。

## 约束体系速查

**硬约束 44 项**（audit_all.py 验证）：
- A 结构与课时 8 项：课时账本、正课/自习拆分、白天自习恰5节、晚自习恰10节、周三8-9自主、周一9班会、早读一三五语文二四英语、夜自习空
- B 排课规则 20 项：体育周二五+第6节配对、艺信每时段2班、不排前两节、语数连排恰1对+整块+周五禁+全校同日、语文2/0/1/1/1、英语每天1节、数学恰1天2节、小科每天≤1节、语数外半天制、语英错峰、H24禁课时段、教师不冲突
- C 教师负荷 16 项：每晚18人、晚1晚2同进同出、晚自习天数配额、值守分配+弹性池、五人轮值、H28白天>晚上、H29无课日不上自习、C13带≥6班每天≤3班、物理集中制、H40带2班禁跨半天、个人条款（王老师/刘植雨/王芳/王建珍/王艳萍）

**软约束 15 项**（达成度报告）：S7空一天、S9班主任周一晚、S10数学上午、S12一天一遍、S13自习优先8/9、S14自习分散、S18半天内间隔、S19值晚自习下午有课、S21带3+班不跨半天、C16正课半天制、H21数学半天制、H31先上课后自习、H36先小班后大班、S16数学日净化

## 关键陷阱

1. **UNKNOWN 状态的部分解不可信**：只认 FEASIBLE/OPTIMAL，UNKNOWN 一律弃用（曾输出限改150格实改919格的假解）。
2. **求解参数**：`MAX_T=600`、4 workers、`DET_DIV=2`；8 workers 易内存不足（exit 137）。
3. **加了新硬约束后**，旧课表作为微调基准会因 hint 带偏搜索（UNKNOWN）——此时改用 `solve_global.py` 全局重排，或先写纯可行性探针确认约束可满足。
4. **H24 禁课时段口径**（2026-08-30 用户收紧）：该半天该科目正课+自习全禁（含第3节学科自习位），即老师不出现在该半天。代码里上午槽位清单是 `[1,2,3,4,5]`。
5. **合并表布局**：两块式（上半行3-20=周一/二/三，下半行24-41=周四/五），每组14列（班级|槽1-11|夜自习|空1列），槽位 s → 列 `base+s`，`base=1+(d%3)*14`。
6. **自习标注**：合并表内容 `科目自习\n老师` 表示自习；晚1晚2（槽10/11）无条件算自习；白天槽3/4/8/9 是灵活位可放正课或自习。
