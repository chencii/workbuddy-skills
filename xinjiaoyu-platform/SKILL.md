---
name: xinjiaoyu-platform
description: 操作新教育智能平台（www.xinjiaoyu.com）时使用——阳泉一中的教务/教学 SaaS。当用户提到「新教育」「xinjiaoyu」「教师管理」「班级管理」「导入行政班」「批量修改任课老师」「学生管理」「学情分析」「答题卡」「扫描」「题库卷库」，或给出 xinjiaoyu.com 的链接时加载。含登录复用、整站 URL 地图、导航 DOM 选择器、批量导入/导出流程与校验规则。
agent_created: true
---

# 新教育智能平台（xinjiaoyu.com）操作手册

阳泉一中在用的教育 SaaS。学校管理员视角（roleTypeId=4）。

## 0.0 🔴 先进「学校管理员」角色，否则 /admin/* 全部跳回首页

账号 `17610019211` 挂了 3 个角色：**班主任(8) / 学科教师(9) / 学校管理员(4)**。
**每次登录默认落在「学科教师」**，此时访问任何 `/admin/*` 都会被重定向到 `/`。
表现极具迷惑性：URL 打进去立刻变回首页，看起来像"没登录"。

判定角色：
```bash
agent-browser eval "JSON.parse(localStorage.getItem('__jby_teachingClient__user')||'{}').roleTypeId"
```

切换（写 localStorage 无效，必须走 UI + 刷新）：
1. 点右上角用户名 —— **`.user-name` 的 `.click()` 无效**，要派发完整事件序列：
   ```js
   var n=document.querySelector('.user-name'); var t=n.closest('div[class*=flex]')||n;
   ['mouseenter','mouseover','mousedown','mouseup','click'].forEach(function(ev){
     t.dispatchEvent(new MouseEvent(ev,{bubbles:true,cancelable:true}));});
   ```
2. `snapshot -i` 找 `generic "(班主任|学科教师|学校管理员)"` 的 ref → click
3. `snapshot -i` 找 `option "学校管理员"` 的 ref → click
4. **`location.reload()` 后 roleTypeId 才变成 "4"**（不刷新不生效）

现成脚本：`/tmp/xjy/ensure_admin.sh`（登录 + 切角色 + 打开学生管理页一条龙）。

## 0. 登录（每次会话必做）

登录态存在 **localStorage** 的 `__jby_teachingClient__user`，**不是 cookie**——所以
`agent-browser cookies get/set` 保不住登录态。token 有效期 30 天，但 daemon 一重启就丢。

凭据已存进 agent-browser auth vault（名字 `xinjiaoyu`）。重登脚本：

```bash
agent-browser auth login xinjiaoyu >/dev/null 2>&1
sleep 2
ref=$(agent-browser snapshot -i 2>/dev/null | grep -oE 'button "登 录" \[ref=(e[0-9]+)' | grep -oE 'e[0-9]+' | head -1)
[ -n "$ref" ] && agent-browser click "$ref"
sleep 6
agent-browser eval "location.pathname"    # 应回到 /teacher/data_center_scan_mgmt
```

**坑**：`auth login` 自己找不到提交按钮（会报 `Timed out waiting for submit button`），
它只负责填表，必须自己再点一次 `登 录`。登录成功会跳 `/teacher/data_center_scan_mgmt`。

若 vault 不存在，重建：
```bash
agent-browser auth save xinjiaoyu --url "https://www.xinjiaoyu.com/auth/login" \
  --username "<手机号>" --password-stdin    # 密码走 stdin，别放命令行
```

## 1. 整站结构

- `/home/` 官网落地页（未登录）· `/auth/login` 登录页
- `/teacher/*` 教师端业务 · `/admin/*` 校级管理端
- 顶部导航是 **9 个叶子模块**（后台菜单表实为 4 目录 → 9 菜单，前端把目录层压平了）

| 模块 | 默认地址 |
|---|---|
| 数据中心 | `/teacher/data_center_scan_mgmt` |
| 学情分析 | `/admin/school-analysis-list` |
| 教务管理 | `/admin/school_mgmt_teaching_group` |
| 考试 | `/teacher/examination/list` |
| 校级管理 | `/admin/content_management` |
| 教研集备 | `/teacher/teachingPlan/teachPlanStatistics` |
| 题库卷库 | `/teacher/question_base_paper/selectNew` |
| 征集中心 | `/teacher/collect/center` |
| 下载中心 | `/downloadCenter` |

### 完整 URL 地图

```
数据中心
  扫描管理              /teacher/data_center_scan_mgmt
  学科扫描量统计         /teacher/course_statistics
  作业批改报表           /teacher/hw_garding_res
  布置记录              /teacher/online_recording
  提交明细              /teacher/online_submit_details
  数据汇总              /teacher/online_data_summary
学情分析
  校级报告              /admin/school-analysis-list
  班级报告              /admin/class-analysis-list
  学生追踪              /admin/student-analysis
教务管理
  教学组管理            /admin/school_mgmt_teaching_group
  班级管理              /admin/school_mgmt_classes
  教师管理              /admin/school_mgmt_teachers
  学生管理              /admin/school_mgmt_students
  选科统计              /admin/selected_subjects
考试
  考试管理              /teacher/examination/list
  成绩分析              /teacher/examination/gradeAnalysis
  （阅卷任务是页内动作，无独立 URL）
校级管理
  内容管理              /admin/content_management   （子页签：资源/题库/卷库）
  内容审核              /admin/audit_management
  权限设置              /admin/audit_settings
  纠错管理              /admin/defect_management
  数据统计              /admin/class_data_statistics
  电子书架              /admin/electron_bookshelf
教研集备
  教案统计              /teacher/teachingPlan/teachPlanStatistics
  听课统计              /teacher/teachingPlan/listenStatics
  公开课统计            /teacher/teachingPlan/openClassStatistics
  数据看板              /teacher/teachingPlan/dataBoard
  集备统计              /teacher/teachingPlan/collectiveLessonStatistics
题库卷库
  对点选题              /teacher/question_base_paper/selectNew
  作业与测试            /teacher/question_base/syncSelectNew
  试卷选题              /teacher/question_base_paper/paperSelect
  智能选题              /teacher/question_base/smart_select_new
  校本题库              /teacher/question_base/class_collect_new
征集中心  /teacher/collect/center
下载中心  /downloadCenter
```

## 2. 导航 DOM 选择器（点不动的坑都在这里）

| 层级 | 选择器 | 点击方式 |
|---|---|---|
| 顶部一级导航 | `ul.menu-box > li:nth-child(N)` | JS `.click()` 有效，N=1..9 |
| 二级横向菜单 | `.secondary-header-menu-inner > div:nth-child(N) > span` | **必须点内层 `span`**，点外层 div 无效；用 `agent-browser click` 真实点击 |
| 数据中心页内树 | `.l-tree .setting-item` | JS `.click()` 有效；**用 `querySelectorAll(...)[i]` 精确取**，`nth-of-type` 因有兄弟标题元素会数错 |
| 校级管理页内列表 | `ul.new-menus .menu-item` / `.menu-child li` | JS `.click()` 有效 |
| 题库卷库页内页签 | `.fx-menu a` | JS `.click()` 有效 |
| 考试页内页签 | `.nav-bar .jby-nav-tab-item` | JS `.click()` 有效 |
| 校级管理顶部页签 | `.contentManage-menu.header-menu-item-nrsh`（内容审核） | 真实点击 |
| 二级菜单是否存在的判定 | `document.querySelector('.secondary-header-menu-inner')?.children.length` | 0 表示该模块用页内导航 |

## 3. 教师管理页（最常用）

`/admin/school_mgmt_teachers` — 阳泉一中在校教师 232 人、归档 2 人（24 页 × 10 条）。

- 筛选：账号 / 姓名 / 手机号 / 所授科目 / 角色 / 年级 / 账号状态
- 列：序号、账号、姓名、角色、年级、所授科目、所教班级、手机号、教师状态、账号状态、创建时间、操作
- 按钮：添加教师 · 批量新增 · 批量修改 · 更多（**导出以下全部教师** / 批量离校 / 批量停用 / 批量启用）
- 行内：编辑 · 教学记录 · 更多
- ⚠️ 一名教师可挂多个角色，表格占多行（例：王正庆＝班主任＋学科教师）

取表格数据：
```js
JSON.stringify([...document.querySelectorAll('.ant-table-tbody tr')].map(r=>[...r.querySelectorAll('td')].map(c=>c.innerText.trim())))
```

## 4. 教务管理 · 批量导入导出（重点）

### 4.1 导出教师名单

教师管理页 → 顶部 `更 多` 按钮 → 下拉第一项「导出以下全部教师」。

```bash
# 展开「更多」菜单（按钮文字是「更 多」，中间有空格）
agent-browser eval "(function(){var b=[].slice.call(document.querySelectorAll('.ant-btn')).filter(function(x){return x.innerText.replace(/\s/g,'')==='更多';})[0]; if(b){b.click();return 'cl';} return 'nf';})()"
sleep 2
# 菜单项选择器
agent-browser eval "JSON.stringify([...document.querySelectorAll('.ant-dropdown-menu-item')].map(e=>e.innerText.trim()))"
#   => ["导出以下全部教师","批量离校","批量停用","批量启用"]
# 用 download 命令触发（点 .ant-dropdown-menu-item 第一个）
agent-browser download ".ant-dropdown-menu-item" "/path/教师名单.xlsx"
```

导出表结构：1 行标题 + 1 行表头 + 数据行，**一名教师多角色/多年级占多行**。
列：`姓名,角色,年级,所授科目,所属教学组,行政班,教学班,性别,手机号,账号,用户ID`
⚠️ 字段含逗号（如 `"2510,2516"`），**必须用 `csv.reader` 解析**，不能 `split(',')`。
⚠️ 有「空行」条目（如 `闫惠琴,,,`）——该教师角色/年级/科目未设置。

### 4.2 导入行政班（`/admin/school_mgmt_classes`）

模板列：`班级,语文,数学,英语,日语,俄语,西班牙语,德语,法语,阿拉伯语,韩语,物理,化学,生物,政治,历史,地理,通用技术,信息技术,班主任`
（第 1 行标题、第 2 行说明、第 3 行表头、第 4 行起数据 —— 所以平台报错的「行号」= 4 对应第 1 个班）

**⚠️ 核心校验规则（实测反推，18/18 完全吻合）**：
> 每个**科目列**（第 2–19 列）填的教师，必须在教师档案里存在 **「高一 + 该列科目」** 的任课记录。
> 只比科目不比年级不行；只比年级不比科目也不行。
> **班主任列（第 20 列）不参与科目校验**，只校验人名存在。

所以新年级建班前，必须先把全体任课教师在教师管理里挂上该年级身份，否则整行被拒。
报错文案虽写「教师授课科目与实际不符」，实际是**年级没挂对**。

导入操作（导入入口是个 **抽屉**，不是 modal）：
```bash
# 打开
agent-browser eval "(function(){var b=[].slice.call(document.querySelectorAll('.ant-btn')).filter(function(x){return x.innerText.replace(/\s/g,'')==='导入行政班';})[0]; if(b)b.click();})()"
# 上传（先 har start 抓返回报文）
agent-browser network har start /tmp/imp.har
agent-browser upload "input[type=file]" "/path/xxx.xlsx"
agent-browser eval "(function(){var b=[].slice.call(document.querySelectorAll('.ant-drawer-open .ant-btn')).filter(function(x){return x.innerText.replace(/\s/g,'')==='确定';})[0]; if(b)b.click();})()"
agent-browser network har stop /tmp/imp.har
# 从 har 里取 /school/class/import/new 的响应，结构化 errorList 比读 UI 文本可靠
```

**提速技巧**：若教师数据一时补不齐，可只填「班级 + 班主任」，把第 2–19 列清空 → 班级能先建出来，
之后用「批量修改任课老师」补（平台说明第 3 条明确支持这个顺序）。

### 4.3 批量修改任课老师（班级管理页 toolbar）

模板：`班级,语文,数学,英语,日语,俄语,西班牙语,德语,法语,阿拉伯语,韩语,物理,化学,生物,政治,历史,地理,通用技术,信息技术,班主任,班级ID`
—— **与导入行政班模板 1:1 对齐，只多一列 `班级ID`**。
下载时平台已自动带出**全部班级名 + 现有班主任 + 班级ID**，只需填科目列。

- 说明第 2 条：*导入表格仅修改填写的数据，未填写内容会保留系统原数据* → **可以只填一部分**
- 说明第 1 条：**班级名称、班级ID 请勿修改**
- 下载链接是 `<a class="down-style">`（**无 href**，JS 触发），用 `agent-browser download ".down-style" <path>`

### 4.4 批量修改教师（教师管理页 toolbar）

模板列：`姓名,角色,年级,所教科目,所属教学组,所教班级,教学班,性别,手机号,账号,教师ID`

关键说明：
- 手机号 / 账号至少填一项，手机号不可重复，账号不填则系统自动生成
- **学科老师**：填年级 + 所教科目 + 所教班级；**一行只能记一个年级+一个科目**
- **一名老师有多个角色/年级 → 创建多条记录**，勿合并单元格
  → 所以「给老师追加高一年级」在模型上是允许的，不必改掉原有高二/高三
- 校长/学校管理员/教务主任不用填年级、科目、班级
- 导入前删掉样例名单，但说明部分别删

#### ⚠️ 实测结论（2026-09-21，血泪教训，必读）

**① 覆盖式，不是追加式！**
拿范康羽实测：他原有「高二/语文」，提交一条只含「高一/语文」的记录 → **高二记录被删掉**。
→ **提交时该老师的全部记录（各年级各角色）都必须列进表里**，漏掉的会被清空。
→ 正确做法：先「导出以下全部教师」拿到全量记录，在此基础上给目标老师追加新行，再整表提交。

**② 追加行必须带「教师ID」**，留空报 `[用户ID必填]`。

**③ 🔴 空身份账号会让整个文件报「文件解析异常」**
平台上有老师**只有账号、没挂任何角色**（角色/年级/科目全空，如本次的武志凯/梁树兵/闫惠琴）。
只要表里包含这类老师，平台返回 `{"code":400,"msg":"文件解析异常"}`，**整批失败**，
且提示完全看不出原因。实测：含这 3 位的批次 100% 失败，不含的 100% 成功。
→ **解法**：这几位改走「批量新增教师」+ 冲突弹窗勾选「覆盖」，可成功。
→ 排查手法：按老师拆小批（≤10 位/批）二分，能快速定位。

**④ 大批量不稳，拆小批更可靠**
340 行、351 行的整表都失败（含上述空身份账号）；拆成 20 行左右的小批后 5/7 成功。
**建议每批 9~10 位老师（约 20 行）**，并且每批都要包含该批老师的**完整**现有记录。

**⑤ 填了「所教班级」= 自动建立任课关系**
在修改表里填 `2601班、2605班`，班级管理页对应班级的学科教师就自动挂上了，
**不需要**再走 4.3 的「批量修改任课老师」。
班级名格式：`2601班、2605班`（顿号）或 `2601班,2605班`（英文逗号）都被接受。

#### 冲突信息处理弹窗（重要）

上传后若手机号已存在于系统，会弹「**冲突信息处理**」：
- 每行一个复选框，勾选 = 按 Excel 信息**覆盖导入**；不勾 = 不导入并记为失败
- 底部两个按钮：「跳 过」/「覆 盖」（未勾选时「覆盖」是 disabled）
- 提示：*如"所属学校"或"身份"不同，无法勾选覆盖，请联系客服处理*
- 该弹窗**用 eval 查不到 DOM**（`document.querySelector('.ant-modal')` 返回空），
  但 `agent-browser snapshot` 能看到 → **用 snapshot 拿 ref 再 click**
- 同一学校内的冲突（如空身份账号）：可安全勾选覆盖
- **跨校冲突**（如手机号已注册在另一所学校）：属于跨校人事数据变更，**不要擅自覆盖**，
  应让用户决定（联系平台客服 / 换手机号 / 用无手机号的账号建号）

### 4.5 单独编辑教师

教师管理 → 行内「编辑」→ 弹窗「编辑教师」，含：
- 基本信息：教师姓名 / 性别 / 手机号 / 账号（默认密码 `xjy111`）
- 身份信息：`身份1 [角色▾][年级▾][科目▾] 班级:全部/2501…2519` + **「添加身份」按钮**
  → 追加身份走这里；提示「请至少保留一个身份信息」

## 5. 学生管理 · 批量新增学生（`/admin/school_mgmt_students`）

页面结构：左侧树 `阳泉一中 > 高中 > 2026-2027 > 高一(0人) > 行政班 > 2601班(0人)…` + `教学班` + `高二(共4496人)` / `高三(共2195人)` / `毕业生` / `归档学生(770)`。
树节点用 `.ant-tree-title` 文本前缀点击；点节点后表格才是该范围数据。
按钮：`批量修改学生` · `批量新增学生` · `添加学生` · `全局检索学生` · `更多`（含 `导出学生`）。

### 5.1 模板

下载链接在抽屉里：`<a class="down-style">点击下载</a>` → OSS 直链（新教育新增学生模板.xls）。
也可以直接 curl：
`https://bjjbydist.oss-cn-zhangjiakou.aliyuncs.com/files/新教育新增学生模板.xls`

结构（**与教师模板不同，行号错位**）：
- 第 1 行 说明（**必须保留**）
- 第 2 行 表头：`姓名|年级|学号|行政班|教学班(18科)|选考科目|账号|学籍号|性别|入学年份|手机号|笔id|笔盒id`
- 第 3 行 教学班子表头（A–D 空，E 起 语文/数学/…/韩语）
- 第 4 行起 数据 → **平台报的 rowNumber 4 = 第 1 个学生**

上传 input 的 accept = `.xlsx` + `.xls` 都收，直接给 .xlsx 即可。
抽屉里按钮是 `确 定`（`批量新增学生` 也是右侧抽屉，非 modal）；上传 → 确定 → 抽屉内出结果表「成功导入 N 条，失败 M 条」+ 行号/错误信息。

### 5.2 🔴 学号（平台叫「新教育号」）两条硬规则

导入返回的原始报文里字段名是 `studentCode`，错误信息见 `errorList[].errorMessage`。

| 规则 | 实测报错 |
|---|---|
| **必须是 5 位数字** | `990000001` → `新教育号必须是5位数字;` |
| **全局唯一** | `60101` / `20103` / `20113` → `新教育号已存在;` |

⚠️ **「已存在」的范围比本校大**：`20103` 在本校学生管理页搜不到（高一/高二/高三/归档都查不到），导入仍报已存在。
所以**不要拿「本地没查到」当可用依据**，只能靠试导。

已知被占号段（阳泉一中，2026-09 实测）：
- 高三：`40101–42295`（≈40100+n）
- 高二：`57701–62196`（≈57700+n，共 4496 人）
- `10000–39999` 中的 `20xxx` 也大量被占

**可用且已实测通过的方案**：`7 + 班号2位 + 班内序号2位`
→ 2601 班第 1 人 = `70101`，2618 班第 41 人 = `71841`（仍是 5 位）。
（用户原始的 `6 26级 + 班 + 序` 方案在 6 开头撞高二号段，不可用。）

✅ 2026-09-23 实测：高一 18 班 **857 人全部用 7 号段导入成功**，0 失败。班内序号按**考号升序**排。

### 5.3 导入脚本（`/tmp/xjy/`）

| 脚本 | 作用 |
|---|---|
| `ensure_admin.sh` | 登录 + 切学校管理员 + 打开学生管理页 |
| `import_students.sh <xlsx> [har]` | 开抽屉 → 上传 → 确定 → 停 HAR → 打印页面提示 |
| `run_rest.sh` | 逐班批量导入（每班前 `open` 页面重置状态） |
| `search_stu.sh <学号>` / `probe_scope.sh <树节点> <学号>` | 按学号在本校范围内检索 |

批量导入的返回在 HAR：`POST /api/v3/server_school/school/student/import/save`，
`data.successNumber` / `data.failNumber` / `data.errorList[]`。
每班一组文件 + 一次导入（40~55 人/批）实测 100% 成功，比一次 857 行稳。

### 5.4 学生列表接口（拿数据的正路）

`POST /api/v3/server_school/school/student/list`
body 关键字段：`{"classId":"3510318","isAtSchool":true,"gradeId":"10024","phaseId":"10000","schoolId":"106486","queryType":2,"size":40,"current":1}`
→ 有动态签名头 `t` + `encrypt`，**直接 fetch 会 200 空 body**，只能走 HAR 或 UI。

#### 导出学生（核查导入结果的正路）

选中树节点 → `更多` → 第 1 项 `导出学生`（`更多` 菜单：导出学生/重置密码/批量停用/批量启用/批量恢复学生/批量退学/批量设置选考科目）。
**导出覆盖该树节点下的全部学生**（实测 51 人的班导出 51 行，不受当前页 size=40 限制）。
「一个班一个文件」导出后逐条比对，是核查导入结果最可靠的办法。
脚本：`/tmp/xjy/export_all.sh`（逐班导出到 `/tmp/xjy/va/exp_<班号>.xlsx`，约 25s/班）。

🔴 **导出表列位（按列号取，别按出现顺序猜）**：

| 列号 | 0 | 1 | 2 | 3 | 4 | 5–22 | 23 | 24 | **25** | 26 | **27** |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 含义 | 姓名 | 年级 | 学号 | 行政班 | 教学班 | 各科(语文起) | 选考科目 | 学籍号 | **性别** | 入学年份 | **账号** |

- 第 1 行是大标题「阳泉一中学生名单」，第 2 行才是表头，第 3 行是科目子表头 → **数据从第 4 行起**
- ⚠️ 性别在第 **25** 列。曾误用第 12 列（那是「地理」科目列，恒为空），导致性别核对恒真、结论无效。
  **核对前必须先 dump 一行表头确认列位。**
- `账号`（第 27 列）是导入后自动生成的登录账号（形如 `题 26yy70101`），可直接导出给学生。

### 5.5 🔴 两份名单合并时：班内同名必须按「出现次序」配对

数据常来自两份文件 —— 一份有**考号/考场**（如《月考名单》），一份有**性别/身份证**（如《年级学生名单》）。
按 `(班, 姓名)` 建索引合并时，**同一班内出现两个同名学生的概率不低**（实测 2616 班有两名「杨雨泽」）。

❌ 错误写法：`info = index[(cls, name)][0]` —— 两个同名者会拿到**同一个身份证号**（取的都是第一条）。
✅ 正确写法：用**出现次序计数器**逐个消费：

```python
used = defaultdict(int)
for e in exam_rows:
    k = (e['cls'], e['name'])
    i = used[k]; used[k] += 1
    lst = src_index.get(k, [])
    gender, idn = lst[i] if i < len(lst) else (lst[0] if lst else ('', ''))
```

**排查方法**：合并后按 `(班, 身份证号)` 反查重复 —— 若同班出现两条相同身份证，就是踩了这个坑。
交付前务必跑一遍：
```python
Counter(x['id'] for x in final)   # 身份证应全部唯一
```

⚠️ 顺带：若导入模板**不含身份证列**（本平台模板的「学籍号」列留空就不用填），
这类错误**只影响本地交付名单、不影响平台数据**，修完不必重新导入。

## 6. 后端接口

导航由接口下发、按角色过滤：

| 接口 | 作用 |
|---|---|
| `GET /api/v3/server_system/user/self/{roleId}/menus` | 可见菜单树（四级：目录/菜单/按钮/页面功能） |
| `GET /api/v3/server_system/system/menu/order?roleTypeId=4` | 菜单排序 |
| `GET /api/v3/server_system/user/self/{roleId}/report/menus` | 学情分析报表菜单 |

鉴权头：`Authorization: JBY <jwt>` · `accessToken` · `clientSession` · `platformType: 1` ·
`client: front` · `deviceType` · `device`，另有**动态签名头 `t` / `encrypt`**。

⚠️ **直接用 fetch 带这些头调接口会返回 200 但 body 为空**（缺动态签名）。
要拿接口数据走 HAR：

```bash
agent-browser network har start /tmp/x.har
agent-browser eval "location.reload()"
sleep 12
agent-browser network har stop /tmp/x.har
# 再用 Python 从 har 里取 entry['response']['content']['text']
```

## 7. 通用摸底套路（换任何 SPA 后台都适用）

1. `curl -o /dev/null -w "%{http_code}"` 确认可达
2. 打开站点 → 判断是否 SPA（HTML 里全是 `<div id=app>` + 一堆 JS 就是）
3. 登录（见第 0 节）
4. **先找导航接口，别一个个点**：`agent-browser network requests --clear` → reload → `grep -iE "menu|nav|role"`
5. 接口直调被签名挡住 → 改 HAR 拦真实响应
6. 用 API 拿到的菜单树当"目录"，再用 UI 点击补上「routeName → 真实 URL」的映射
7. 逐层读 DOM 类名，写进调用脚本，批量跑

**别做的事**：不要试图从 JS bundle 里 grep 路由——这类微前端（`frontWorkspace`）的路由表
不在 `app.js` 里，grep 不到。

### 5.6 批量修改学生 · 换学号（新教育号）实操

入口：学生管理页 `批量修改学生` → 右侧抽屉，模板 `新教育修改学生模板.xls`（结构与新增模板完全同构：
第1行说明/第2行表头/第3行科目子表头/第4行起数据；列：姓名|年级|学号|行政班|教学班18科|选考科目|账号|学籍号|性别|入学年份|手机号|笔id|笔盒id）。

**实测结论（2026-09-24，857 人换号）**：

- 修改按「账号」（或班+姓名）匹配学生；**同名同班两人必须在账号列填各自真实账号**才能区分 ——
  若按 (班,姓名) 查账号会让两人拿到同一账号，整行报 `表格中账号重复`。
  正确做法：按**旧学号**逐人查账号（导出表的 账号 列与学号一一对应）。
- 账号列填现有账号 → 账号保持不变；**学号（新教育号）改了账号不会跟着变**。
- 性别必填（红色字段），不填可能被拒。
- 🔴 **换号撞号必须两遍**：新教育号逐行校验「已存在」。若新旧号段大面积重叠（如 70/71 段），
  先把所有人挪到空闲临时段（**9xxxx 实测全平台无占用**），再第二遍落到目标号。
  只按拓扑顺序排一遍不行 —— 置换里有环，环必须借助临时号。
- 批量流程脚本：`/tmp/xjy/build_modify.py`（生成文件）、`run_modify.sh`（逐批上传，轮询 `成功导入` 文本变化）。
  每批 ≤45 行稳；54 批约 12 分钟。
- 改完核验：重新逐班 `导出学生`，按 (班, 考号) 三元组比对学号/姓名/班级归属（同名学生靠学号区分，别按名字数）。
