# 各种来源怎么变成「课时文本」

核心思路：**不管来源是什么，先转成"一节课一个文本文件"**，格式见 `schema.md`。
后面的解析和渲染就完全一样了。

```
来源 ──▶ 课时文本(01_课时名.md) ──▶ parse_questions.py ──▶ deck.json ──▶ HTML
```

---

## 一、ima 知识库（当前主用）

ima 里的「高中数学资料 / 数学题型 / 高一题型课」是按「章节文件夹 → 每节课文件夹（内含原始 PDF + 去水印 PDF）」组织的。

拉取步骤：

1. 用 ima 的连接器工具列出知识库 → 找到章节文件夹下的课时子文件夹。
2. 每个课时文件夹里通常有**两个 PDF**：原版、去水印版。
   **选哪个？看它 `introduction` 预览里有没有 `$` 公式** —— 有 LaTeX 的那个解析质量好，另一个可能是 OCR 乱码。
3. 取到该 PDF 的 markdown 文本 → 存成 `NN_课时名.md`（`NN` = 课时号的两位形式）。

一个现成的参照：本技能开发时的项目里，`work/ima_src/manifest.json` 记录了全部课时的
`chapter / lesson_no / lesson_title / folder_id / md 文件路径`。
如果沿用这种「目录 + manifest」的组织方式，直接用：

```bash
python3 scripts/build.py --src <课时md目录> \
    --manifest <manifest.json> \
    --title "08_函数-指数、对数运算" \
    --out "函数-指数、对数运算.html"
```

`--manifest` 支持 `[{md/file, lesson_no, lesson_title}]` 或 `{文件名: {no, name}}` 两种写法。

**已知坑**：
- ima 的标题行带 markdown 井号 → 解析器会自动去掉。
- PDF 页脚会有「ABOUT MATH / 扫码 / 页码 / 水印」→ 解析器按 `is_junk` 过滤。
- 图片化的公式 ima 会 OCR 成「字符被空格拆碎的碎片」→ 解析器按 `is_garbage` 丢弃（宁可少，不要错）。
  遇到必须保留的，手工补到解析区的对应题号下。

---

## 二、Word（.docx）

```bash
python3 scripts/docx_to_text.py 题目.docx -o 01_指数运算.md
python3 scripts/build.py --src 01_指数运算.md --title "指数与对数练习" --out out.html
```

`docx_to_text.py` 会把 Word 公式（OMML）转成 LaTeX：
支持 **分数、上下标、根式、括号、求和/积分、极限、上划线/重音、上下花括号、矩阵**。
`--report` 会列出没覆盖到的公式结构（这些地方退化成纯文本，需要人工补 LaTeX）。

### 公式的三种情况

| Word 里公式的形态 | 怎么处理 |
|---|---|
| Word 公式编辑器（OMML） | 脚本自动转 LaTeX ✓ |
| 文字形式（如 `x^2+1`、`根号x`） | 转出来是纯文本，建议手工改成 `$x^2+1$`、`$\sqrt{x}$` |
| 图片截图 | 转不出来。用 `glmocr-formula` 技能 OCR 成 LaTeX，或用 `wpscli` 把 Word 转格式后再取文本 |

**最省事的办法**：在 Word 里选中公式 → 复制 → 「粘贴为 LaTeX」，贴回文档，再跑脚本。

### 一个 Word 里多节课怎么办

按课时手动拆成多个文件；或者先整体转文本，再按「课时标题行」切开。拆完记得命名
`NN_课时名.md`，这样连 `--manifest` 都不用写。

---

## 三、PDF（扫描件 / 习题册）

1. 首选 `wpscli` 技能：PDF → Word（可搜索）→ 再走上面的 Word 路径。
2. 数学公式多的话用 `glmocr-formula` 技能专门 OCR 公式。
3. 文本层质量差的，转出来的公式往往是碎片 → 会被 `is_garbage` 丢弃，需要人工补。

---

## 四、纯文本 / Markdown / 网页

直接按 `schema.md` 的书写习惯整理成一个文件即可，不需要任何转换脚本。

---

## 五、转完之后先自检

`build.py` 会打印每节课的「题数 / 解析数」，两者不等就会提示。常见原因：

| 现象 | 原因 | 处理 |
|---|---|---|
| 题数明显偏少 | 题号没从 1 开始，或中间跳号 | 改成连续编号 |
| 解析数为 0 | 没有 `（解析）` 分隔行，或答案段没有用题号开头 | 补上分隔行；答案每题用 `1.` `2.` 开头 |
| 解析数少于题数 | 个别题确实没写答案（正常），或答案段被【提升】切掉了 | 检查切割标记位置 |
| 出现乱码碎片 | 图片公式的 OCR 残留 | 手工补 LaTeX |

中间产物 `<输出名>.deck.json` 会留在输出目录旁边，可以直接手改 JSON 再单独渲染：

```bash
node scripts/render_deck.js 函数-指数、对数运算.deck.json 函数-指数、对数运算.html
```
