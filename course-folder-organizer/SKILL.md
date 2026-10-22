---
name: course-folder-organizer
description: 整理"题型课/网课"类课程文件夹（如 数学高一/高二题型课）。流程：① 把所有视频移入废纸篓；② 用 Python zipfile 原地解压所有 zip（中文文件名 UTF-8 处理 + 损坏包/0字节校验）；③ 把中文数字章节前缀（一、二、…五十四、）改为两位零填充阿拉伯数字前缀（01_…54_），去掉中文数字，使 Finder 按 1,2,3… 排序。触发词：删掉所有视频、解压压缩包、更改文件夹名称、改成阿拉伯数字、章节改名、NN_ 前缀、题型课整理。
agent_created: true
---

# 课程文件夹整理（删视频 / 解压 zip / 章节按数字排序改名）

适用于"每节一课=子目录(video+zip)"结构的课程文件夹，顶层为中文数字章节（一、二、…五十四、）。

## 步骤

### 1. 扫描（只读，先确认再动手）
- 用 Python `os.walk` 统计：视频数（mp4/mov/avi/mkv/flv/wmv/m4v/webm/rmvb/ts/3gp）、zip 数、顶层章节数。
- 抽查 zip 内容：`zipfile.ZipFile` 读文件名。macOS 自带 `unzip -l` 对中文名显示乱码是正常的，Python 读出的就是正确 UTF-8。
- 生成待删视频纯路径清单（注意：不要混入 `\t大小` 之类的列，路径必须干净）。

### 2. 删除视频 / zip → 废纸篓（关键坑）
- **沙箱内 `osascript` Finder 自动化必被 TCC 拦截（-10004 权限违例）**；即使 `dangerouslyDisableSandbox=true` 也照样失败。不要浪费时间重试。
- 可靠做法：`dangerouslyDisableSandbox=true` 的 Bash 里 `mv "<file>" ~/.Trash/`。
- 同名冲突处理（防止覆盖废纸篓旧文件）：目标已存在时用 Finder 风格改名 `"stem n.ext"`（`stem 2.ext`、`stem 3.ext`…）。
- 用 `while IFS= read -r` 循环遍历清单（zsh 没有 `mapfile`！）。
- 源树残留校验：删除后 `find` 计数应为 0。

### 3. 解压 zip（Python zipfile，原地解压）
- 解压到 zip 所在目录；逐条目写文件，避免 `z.extract` 的 zip-slip 风险：拒绝绝对路径、`..` 路径，只取 `os.path.basename`。
- 逐 zip/逐条目 try/except 容错，定位坏包（`zlib.error: Error -3` = 数据损坏）。
- 坏包抢救：查同目录是否有 `(1)` 重复副本；从副本单独解出缺失文件。
- 全量校验：0 字节文件、`%PDF` 头（前 4 字节）逐一检查。

### 4. 清理空目录 + 章节改名
- 空目录 bottom-up 删除（`os.listdir(d)==[]` 才 `os.rmdir`），**保留顶层章节目录骨架**（否则章节编号会缺号）。
- 中文数字→阿拉伯转换（一~九 + 十/百/千，支持"四十三"类组合），新名 `f"{n:02d}_{rest}"`：
  ```python
  num={'零':0,'一':1,'二':2,'两':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9}
  unit={'十':10,'百':100,'千':1000}
  def cn2int(s):
      t=0; cur=0
      for ch in s:
          if ch in num: cur=num[ch]
          elif ch in unit:
              u=unit[ch]; cur=cur or 1; t+=cur*u; cur=0
          else: break
      return t+cur
  ```
- 正则 `^([零一二两三四五六七八九十百千]+)、(.*)$`，把 `、` 前的中文数字替换为 `NN_`，`rest` 去前导空格。
- 两位零填充是排序关键（`01_` 才能让 10 排在 2 之后）。

## 注意事项
- 用户偏好：删除/批量改名前先列清单确认；删除类操作一律走废纸篓（可恢复），不用 rm。
- 章节编号缺号（如高一缺 34）属原始数据，不要"补号"硬改。
