---
name: bilibili-comments-export
description: 导出B站（bilibili）视频评论区全部文字。支持导出完整评论（一级评论+楼中楼）为CSV，并按"低等级低赞剔除"规则自动生成精华评论Markdown报告。当用户提到"导出B站评论"、"爬取B站评论区"、"B站评论分析"、"bilibili评论区导出"、"某视频的评论"、"B站评论精华"等意图时使用。用户给出B站视频链接或BV号即可触发。
---

# B站评论区导出

将 B 站视频的全部评论（含楼中楼/二级回复）导出为 CSV，并自动生成"精华评论"Markdown 报告。同时支持按 UP 主名字获取其全部视频列表，并批量导出所有视频的评论。

## 触发场景

- 用户提供 B 站视频链接（https://www.bilibili.com/video/BVxxxx...）或 BV 号，想导出评论文字
- 用户想分析某个视频/某位 UP 主的评论区（高赞评论、完整对话链、筛选低等级用户发言）
- 用户提到"导出评论"、"评论精华"、"评论区内容"、"爬评论"等
- 用户给出 UP 主名字，想获取其全部视频 BV/AV 号，或导出其所有视频的评论

## 工作流程

### A. 导出单个视频评论（主流程）

### 1. 提取 BV 号
从链接 `https://www.bilibili.com/video/BV1AquczJE6F/...` 中提取 `BV1AquczJE6F`；用户直接给 BV 号则直接用。一个或多个均可。

### 2. 准备环境（首次需要，之后可复用）
```bash
# 依赖: requests, pandas（pip 安装，建议用国内镜像加速）
python3 -m venv .venv
.venv/bin/pip install -r scripts/requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple
```
如果已存在 `.venv` 且依赖齐全则跳过此步。

### 3. 配置 Cookie（必需，否则只能抓到少量评论）
Cookie 文件路径：脚本所在目录的 `bili_cookie.txt`（即 `<skill>/scripts/bili_cookie.txt`）。

- **已有文件**：检查是否非空。若脚本输出"未登录"或每页只有几条评论，说明 Cookie 失效，需更新。
- **没有文件/已失效**：请用户提供。最简单的方式：
  1. 让用户用浏览器登录 bilibili.com
  2. Safari：菜单栏「开发」→「显示网页开发者工具」→「网络」→ 刷新页面 → 任选请求 → 复制 `Cookie` 请求头整段
  3. 将 Cookie 粘贴到 `bili_cookie.txt`
- 也可尝试从本机 Edge/Chrome 的 Cookies 数据库自动解密提取（macOS 需钥匙串授权），失败则回到手动方式。

> 安全提示：Cookie 是登录凭证，仅写入本地 `bili_cookie.txt` 使用，不要外传。

### 4. 运行导出
```bash
cd <skill>/scripts
.venv/bin/python bili_comments_export.py BV1xxxx BV1yyyy [选项]
```
常用选项：
- `--top N`：精华报告展示 TOP N 条（默认 20）
- `--min-like M`：低赞判定阈值（默认 30，点赞低于此值视为低赞）
- `--low-level L`：低等级判定上限（默认 3，等级≤此值视为低等级）
- `--no-second`：不爬楼中楼（默认爬）
- `--no-highlight`：不生成精华报告（默认生成）

### 5. 展示结果
输出文件在 `scripts/exports/` 目录：
- `{视频标题}_BV号.csv` — 全量评论（utf-8-sig，Excel 直接打开不乱码）
- `{视频标题}_BV号_精华.md` — 精华评论报告

用 present_files 把两个文件展示给用户，并简要汇报：评论总数、一级/楼中楼数量、剔除条数、精华 TOP 条数。

## 精华报告过滤规则

- **剔除**：「用户等级 ≤ low-level 且 点赞数 < min-like」的评论（完全筛除不展示）
- **保留**：其余全部（高赞评论 / 高等级评论 / 低等级但高赞的评论），按点赞数降序
- 每条入选评论展示**完整对话链**（全部楼中楼回复，按时间排序）
- 评分思路：低等级用户无粉丝基础，能拿高赞说明内容真实打动路人，应保留；低等级+低赞是噪音，剔除

## 对已有 CSV 单独重跑精华报告

不重新爬取，只对现有 CSV 重新生成精华报告（换参数时用）：
```bash
.venv/bin/python bili_highlight.py exports/xxx.csv --top 30 --min-like 50 --low-level 3
```

## B. 按 UP 主名字获取视频列表 / 批量导出评论

用 `bili_up_videos.py`：
```bash
# 只拉视频列表（按点赞排序，输出 exports/{UP主}_视频列表.csv）
.venv/bin/python bili_up_videos.py "UP主名字"
.venv/bin/python bili_up_videos.py "UP主名字" --order like     # 点赞（默认）
.venv/bin/python bili_up_videos.py "UP主名字" --order pubdate  # 发布时间
.venv/bin/python bili_up_videos.py "UP主名字" --order click    # 播放量

# 列表 + 批量导出全部视频评论（每个视频产出 CSV + 精华.md 到 exports/{UP主}/）
.venv/bin/python bili_up_videos.py "UP主名字" --export
.venv/bin/python bili_up_videos.py "UP主名字" --export --start 11 --end 20  # 只导第11~20个
```

注意：
- 视频列表按 `--order` 排序；点赞排序时列表接口不返回点赞数明细，以排序序号为准
- **断点续跑**：中途中断后重跑同命令，已完成的视频（输出文件已存在）自动跳过
- 批量导出很耗时（一个视频 1~5 分钟），几百个视频可能跑数小时，建议用 `--start/--end` 分批
- 排序接口一次最多翻 ~60 页（约 3000 视频），一般 UP 主足够

## 常见问题

- **只抓到 3~5 条评论 / IP 属地全是"未知"** → Cookie 未配置或已失效，重新配置
- **请求频繁报错（-412 风控）** → 脚本已内置限速（每页停 1~10 秒、每 1000 条停 30~60 秒），无需干预；若持续报错建议降低频率或稍后再试
- **wbi 密钥** → 脚本每次运行自动从 B 站获取，失效自动兜底内置密钥，无需维护
- **评论特别多（几万条）** → 会跑 10~30 分钟，可随时 Ctrl+C 停止，已抓数据实时落盘不会丢
