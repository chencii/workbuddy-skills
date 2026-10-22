---
name: schedule-refine
description: "对已有课表做局部微调（OR-Tools CP-SAT 邻域微调）。当用户要求『微调课表/调整某老师某天的课/把某节课挪走/某老师某半天上几节课/两个班都上课/先小班后大班』时使用。支持 TUNE 定向约束（节数、each 每班都上课、ord 顺序）+ 变化格数上限 K + 全套软目标优化。"
agent_created: true
---

# 课表微调（schedule-refine）

## Overview

以已有课表为基准，限定「总变化格数 ≤ K」，在保持全部硬约束的前提下最大化软目标，实现局部微调——改某位老师某半天节数、把违规划课挪走、让两个班都上课等。

## 环境与路径

- 工作区：`/Users/cc/.qwenworkcn/workspace/mt7cq04avyu4ocg3/`
- Python：`/Users/cc/.workbuddy/binaries/python/envs/default/bin/python`
- 核心脚本：
  - `refine_schedule.py BASE.xlsx K OUT.xlsx [MAX_T] [WORKERS]` —— 邻域微调
  - `solve_global.py OUT.xlsx` —— 全局重排（约束大改时用）
  - `probe_h40.py OUT.xlsx` —— 纯可行性探针（验证新约束能否满足）
  - `diag_compact.py` / `compare_versions.py` —— 诊断与两版对比

## 操作步骤

1. **诊断现状**：先查目标老师/班级当前课表与违规点（用针对性 python 脚本或 diag_compact.py）。
2. **表达定向要求（TUNE 环境变量）**，格式 `TUNE="老师:天序号:范围:值"`，多条用分号分隔：
   - 天序号：0=周一 … 4=周五，`-1`=每天
   - 范围：
     - `am`（第1-5节含第3节）/ `pm`（第6-9节）/ `day`（1-9）/ `eve`（晚1晚2）/ `all`（1-11）→ 值为目标节数（硬）
     - `each` → 该天每个带班都至少 1 节（"两个班都上一遍"），值填 1
     - `ord` → 该天小班(≤2612)课全部早于大班(≥2613)（先小班后大班），值填 1
   - 例：`TUNE="郝文玫:-1:ord:1;范康羽:0:am:2;范康羽:0:each:1"`
3. **运行微调**：
   ```bash
   TUNE="..." W21=30 W36=150 python refine_schedule.py output/全年级课表_<基准>.xlsx <K> output/全年级课表_v<新版>.xlsx 600 4
   ```
   - K（变化格数上限）：小改动 16-30；中等（挪课+连带）45-60；大重排 90-150
   - 权重环境变量：`W18A`(隔1节,默认12)、`W18B`(隔2节,40)、`W19`(晚自习连贯,60)、`W21`(跨半天,30)、`W36`(先小班后大班,80-150)
4. **验证**：`check_final.py`（18硬）+ `compare_versions.py 基准 新版`（量化对比+变化清单）+ 针对性检查目标老师是否达成。
5. **更新交付物 + 部署**：同 schedule-from-scratch 的交付链路（cp → build_merged_table → build_checker_html → 只替换 website/index.html 的 SCHED_DATA 行 → 部署）。

## 关键陷阱

1. **基准违反新约束时 hint 会带偏搜索** → 直接 refine 会 UNKNOWN。正确路径：
   - 先写探针确认约束可满足（参考 probe_h40.py 模式，纯可行性几秒-几分钟出结果）
   - 约束可满足但仍 UNKNOWN → 改用 `solve_global.py` 全局重排（带软目标，约 8-10 分钟），再以新解为基准 refine 逐步优化
2. **UNKNOWN 部分解不可信**：refine 已改为只认 FEASIBLE/OPTIMAL，UNKNOWN 直接放弃输出（曾出现"限改150格实改919格、晚自习变艺术"的假解）。
3. **ord 模式的限制**：老师所有带班都在 ≤2612（或都 ≥2613）时 `ord` 无效（big/small 一侧为空会 continue）。范康羽(2601/2606) 就属于这种，需另加约束才能要求"先小班号后大班号"。
4. **组合约束过紧**：多条 TUNE 一起上容易 UNKNOWN → 拆开逐条加，或先 each 后 am。
5. **改动后复查受影响老师**：用 compare_versions.py 的变化清单 + 跨半天诊断，确认没有把别人的课调散。

## 版本历史要点

- v61/v62：首次引入 S18 间隔分级 + S19 晚自习连贯（先理解反了方向，用户澄清后修正为"下午无课却值晚自习"）
- v63：修正 S19 定义后压到 6 人次
- v65：新增 H40（带2班老师禁跨半天，硬）+ S21（带3+班跨半天软罚），全局重排
- v66-v67d：TUNE 定向微调接口诞生（范康羽周一上午2节、郝文玫先5后17、两班都上课）
