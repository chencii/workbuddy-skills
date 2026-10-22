---
name: bilibili-subtitle-download
description: >-
  输入 B 站视频链接（完整 URL / BV 号 / av 号 / b23.tv 短链），下载视频字幕并导出为
  TXT 文本文件。支持多 P 视频、多语言字幕自动选择（可指定语言）、可选带时间戳输出。
  适用于"把某个 B 站视频的字幕存成文字"的场景。注意：获取字幕列表需要用户提供 B 站
  SESSDATA Cookie（下载字幕文件本身不需要）。
version: 1.1.0
---

# B 站字幕下载器

把 B 站视频的字幕变成本地 TXT 文件。纯 Python 标准库实现，无需安装任何依赖。

## 何时使用

- 用户说"下载某个 B 站视频的字幕""把视频台词导出成文本""提取 B 站字幕存为 TXT"等。
- 用户给了一个 B 站视频链接，想要其中的字幕/台词文字。

## 用法

脚本位于本 skill 目录下的 `scripts/download_subtitle.py`。用**托管 Python**运行：

```
<managed_python> <skill_dir>/scripts/download_subtitle.py "<视频链接>" [选项]
```

其中 `<managed_python>` 为托管的 python3 绝对路径（不要用系统 python）。
`<skill_dir>` 即本文件所在目录。

**Cookie 默认已存在技能目录的 `.cookie` 文件中，脚本会自动读取，无需每次传参。**
如需临时换 Cookie，可用 `-c` / `--cookie-file` / 环境变量 `BILI_COOKIE` 覆盖。

### 参数

| 参数 | 说明 |
|---|---|
| `link`（可选） | 视频完整 URL / `BVxxxx` / `avxxxx` / `b23.tv` 短链（`--check` 模式下可省略） |
| `-o, --out` | 输出目录，默认当前目录 |
| `-l, --lang` | 指定字幕语言代码，如 `zh-CN`（UP 主上传中文）、`ai-zh`（AI 自动生成中文） |
| `-t, --timestamps` | 输出带时间戳（格式 `[mm:ss.xx --> mm:ss.xx] 内容`） |
| `-c, --cookie` | 临时指定 B 站 Cookie 字符串（需含 `SESSDATA=...`） |
| `--cookie-file` | 临时指定从文件读取 Cookie |
| `--check` | 仅检查 Cookie 有效期与登录态后退出（退出码 0=正常，1=失效） |

## Cookie 的存放与自动检查（重要）

`api.bilibili.com/x/player/wbi/v2` 接口在**未登录状态下大多数视频返回空字幕列表**，
必须带 `SESSDATA` 才能拿到字幕。本技能把 Cookie 固化在：

```
<skill_dir>/.cookie        # 权限 600，仅本用户可读写
```

**每次运行都会自动：**
1. 读取 `.cookie`（除非用 `-c` 等显式覆盖）；
2. 解析 `SESSDATA` 内的过期时间，并调用 `nav` 接口核实登录态；
3. 打印一行状态，例如：
   - 正常：`SESSDATA 有效期至 2026-10-16（剩 75 天）；登录态正常：xxx (UID ...)`
   - 失效：`⚠️ SESSDATA 已于 ... 过期，已失效，请更换！`

### 如何更换 Cookie（失效时）

1. 用浏览器登录 bilibili.com
2. 开发者工具（F12）→ Application → Cookies → `https://.bilibili.com`
3. 找到 `SESSDATA` 项，复制它的值
4. 用新值替换 `<skill_dir>/.cookie` 中的 `SESSDATA=...` 段（或直接覆盖整个文件，
   保留 `Cookie:` 之后的内容即可），保存即可，无需改脚本。

> 安全提示：SESSDATA 等同于 B 站登录凭证，`.cookie` 是明文存放（权限 600）。
> 请勿把该技能目录或 `.cookie` 内容分享/提交到任何仓库；如怀疑泄露，在 B 站
> 退出登录再重新登录即可让旧凭证失效。脚本输出中不会打印 Cookie 值本身。

## 典型流程

1. 从用户消息里提取视频链接。
2. 直接运行脚本（默认自动读取技能内 `.cookie`）。若输出提示 Cookie 已失效/即将失效，
   向用户说明需要更换 SESSDATA 并引导更新（见上"如何更换 Cookie"）。
3. 多 P 视频会按 `标题_p1.txt`、`标题_p2.txt` … 分别写出；单 P 直接 `标题.txt`。
4. 若用户要特定语言或要时间戳，加 `-l` / `-t`。
5. 若用户只想确认 Cookie 是否还有效，运行 `--check`。

## 边界情况

- 视频本身没有字幕（无 CC 也无 AI 字幕）：脚本会提示，建议改用语音转文字工具（如
  微信小程序"提词匠"）或本地剪辑软件识别。
- 仅 AI 字幕、无上传字幕：语言代码一般为 `ai-zh`，脚本默认会优先选中文。
- 网络/接口异常：脚本会抛出异常，向用户报告具体错误。
