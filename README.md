# workbuddy-skills

辰子的自建 WorkBuddy skills 集合。每个 skill 是一个独立目录，含 `SKILL.md`（触发描述与使用说明）及配套脚本/资源。

## Skills 清单

| Skill | 用途 |
|---|---|
| bilibili-comments-export | 导出 B 站视频评论区全部文字（一级评论 + 楼中楼），带性别标注、赞数字数排序 |
| bilibili-subtitle-download | 输入 B 站视频链接/BV 号下载字幕 CC JSON，支持 WBI 签名与 Cookie 有效期检查 |
| course-folder-organizer | 整理「题型课/网课」类课程文件夹：视频入篓、zip 原地解压、中文数字章节前缀改阿拉伯数字 |
| exercise-deck | 把「题目+答案」做成单文件 HTML 习题课件（翻页版、答案折叠、一键导出矢量 PDF） |
| handwritten-note-transcription | 手写笔记/讲义/作业照片批量提取文字、按页排序、内容勘误，整理成结构化 Markdown |
| human-writing | 通用中文创作与改稿，去 AI 味、保留活人感，适用于知乎长答/公众号/口播稿等 |
| justin-sun-planning | 以「孙宇晨访谈」思想体系做计划/决策/目标设定的强制检查框架 |
| netpad-teaching-sheet | 为题目制作网络画板（netpad.net.cn）教学素材：2D 分步活页、3D 立体几何、HTML 分步课件 |
| playwright-browser-automation | 直连 Playwright API 的浏览器自动化（导航、交互、抓数据、截图、PDF、录屏） |
| schedule-audit | 检查人工手动修改后的课表：科目数量、教师冲突、自习宽松、半天没课等 |
| schedule-checker-builder | 从课表 xlsx + 教师名单生成单文件交互式课表检查器（高亮、拖拽换位、硬约束校验） |
| schedule-from-scratch | 从零生成高中全年级课表（OR-Tools CP-SAT，44 硬约束 + 15 软约束） |
| schedule-refine | 对已有课表做局部微调（CP-SAT 邻域微调，支持 TUNE 定向约束） |
| schedule-screenshot-recovery | 从低清课表截图复原课表数据（投影法测网格 + 聚类验证，禁止猜填） |
| shusheng | 「书生」对话哲人风格：积极心理学/自我成长/情绪人生困惑的阿德勒式对话 |
| thesis-revision-pipeline | 北师大硕士论文分批改稿流水线（merge → 数字审计 → md2docx） |
| wpscli | 用 wpscli 做 PDF/Office/CAD/图片互转、合并拆分、压缩加密、OCR 等 |
| xinjiaoyu-platform | 阳泉一中新教育智能平台（xinjiaoyu.com）操作指南：登录复用、URL 地图、批量导入导出 |

## 说明

- 依赖环境（`.venv`/`node_modules`/`.deps`）与 B 站 Cookie、评论导出数据均已通过 `.gitignore` 排除，请勿提交。
- 每个 skill 的触发条件与用法见各自目录下的 `SKILL.md`。
