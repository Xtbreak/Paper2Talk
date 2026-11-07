# 已确认大纲的 PPT 生成

这是工作台的生成契约，优先于技能里的默认访谈。仅在学生明确确认 request.json 当前大纲且 outline_current=true 时执行。用户已经确认的方向、论文、大纲、学术风格无需重复询问。聊天进度每次一两句话，描述阶段和已完成页数；遇到失败说明具体原因，不宣称成功。

1. 读取 pipeline.json 指向的两个 SKILL.md。核对路径与运行环境可用；使用已安装环境，不自动安装依赖。生图固定为本地 Codex OAuth、gpt-image-2.5-flare，使用 pipeline.editppt 的 image generate/edit --model gpt-image-2.5-flare。调用前用 --dry-run 核验实际 backend 为 codex-oauth；若不是则报告缺少本地 Codex 登录，不切换付费 API。该适配器是 codex-ppt 的选定生图后端。整个流程都保留该模型与后端。
2. 按 codex-ppt 的版式、提示词、逐页任务记录和组装流程生成设计稿。request.json.outline 是内容和讲稿的唯一已确认版本，页数、顺序、数据、原图和 notes 必须保留。如存在 selected-style.md/png，它们是本次用户明确选择的风格，优先于 approved-style.md/png；将 selected-style.png 作为生图风格参考，遵守其字体、配色与版式。否则 approved-style.md/png 是现有风格参照，采用清晰的现代学术设计、富于变化的布局和克制的设计元素。生成每页图像时传入相应原图作为严格参考，逐页核对科学内容。全部生成文件留在当前任务 workspace 内。先做一页并自行检查风格一致性；本次用户已经授权生成整份，无需额外样张确认。默认在当前会话逐页执行，不询问子代理权限。设计页使用 record_slide_dispatch.py --local --agent-id main 认领；可编辑页使用 editppt run dispatch --local --agent-id main 认领。每页完成并 record 后才认领下一页。该工作台顺序执行模式优先于上游默认并行规则，保留同样的任务记录和质量校验。
3. codex-ppt 生成 origin_image/slide_XX.png 与 speech.md，用其 assemble_ppt.py 组装 design_deck。优先用 pipeline.assembly_python，先确认能导入 pptx；否则使用已有可导入 python-pptx 的 Python；没有则报告缺少依赖。禁止以本地绘图替代生图。
4. 把 design_deck 交给 image-to-editable-ppt：prepare → hints（已配置的 PaddleOCR）→ dispatch → 逐页重建 manifest → build/preview/validate → record → finalize。必须保留其任务记录和最终校验。正文、标题、表格和说明文字使用原生可编辑对象；条形等简单图形使用原生形状。科学原图、公式和实验图直接嵌入 request.json.outline 对应 figure 原文件，保留字节，不让生图重画。visual_inventory 声明 role=foreground、source_type=user-provided，asset_provenance 对应条目写 preserve_original=true、原图 source 路径和 provenance_note，转换器会核对字节一致性；这里的论文证据保真要求覆盖技能的通用素材重生成规则。整页图片不能冒充可编辑版本。保持每页 notes 含完整原讲稿。缺少 TeX 时保留原文公式图并配可编辑符号解释，不自动安装 TeX。
5. 检查重建预览的字体、位置、溢出、原图、数据和页数。字体不支持的下标或公式必须用原图保真，不能擅改符号。应用发布时统一加手动推进的淡入切换，保留已有元素动画；不要自动翻页。重建失败时保留中间文件，返回简短 answer 说明卡在哪一页，等待修复或用户调整；不得退回旧模板或把图片版称为可编辑版。
6. 完成后原子写 result.json：
{"export":true,"confirm_revision":当前request.revision,"pipeline":{"design_deck":"当前任务内图片版PPT绝对路径","editable_run":"当前任务内editppt运行目录绝对路径","editable_deck":"其final输出PPT绝对路径"}}
不得同时返回 brief、papers、selected、outline、count、minutes 或 choice。应用核验当前版本、原图与备注后发布。此时回复“已完成生成，正在检查并打开预览。”不要编造链接或提前声称已发布。

如果中途收到新要求，先判断新增或替换，按当前任务的 request.json 继续。旧目录的产物只能作为参考；新结果必须复制进当前目录、重新核验大纲与 notes，并按新版本生成记录。没有确认的修改应先保存新大纲再等待确认。

用户指定一页时，仅生成一页承载核心创新与关键证据的内容页，不额外生成封面或结尾。可编辑重建后对照设计稿复核字重、字号、图文比例与留白，不能退回统一表格模板。最终正文仅介绍成果与实际局限，不输出 skill 名称、命令、工作目录或内部记录。
