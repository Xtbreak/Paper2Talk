# 学术演讲设计参考原则

先遵循随任务下发的 [approved-style.md](approved-style.md)。本文只提供内容取舍与证据表达参考；已确认的配色、版式、原图标注和动效规范优先。论文检索地区不决定视觉风格。

## 参考来源

### MIT AeroAstro Communication Lab — Slide Design

<https://mitcommlab.mit.edu/aeroastro/commkit/slide-design/>

可提炼：

- slide 应补充讲述，而不是替代讲述；
- 技术细节要围绕核心 message 组织；
- 论文 Figure 需要为演讲重新取舍，而不是机械复制；
- 视觉层级和阅读顺序比装饰重要。

### MIT Broad Institute Communication Lab — Slideshow

<https://mitcommlab.mit.edu/broad/commkit/slideshow/>

可提炼：

- 一页只承担一个主要 message；
- 只保留支撑这个 message 的信息；
- 图通常优先于长文字；
- 简化不能牺牲关键证据。

### Nature / Scitable — Presentation Slides

<https://www.nature.com/scitable/topicpage/presentation-slides-13905480/>

可提炼：

- 标题区域最好回答“so what”；
- 观众很难同时高效听讲和阅读长段文字；
- 少字不等于删掉理解图表所需标签。

### Nature Methods — Talking points

<https://www.nature.com/articles/nmeth0508-371>

可提炼：

- 文字少而精；
- 图示优于长文字；
- 坐标和标签必须足够大；
- 简单背景、高对比、可读字体比特效可靠；
- 动画只有在解释过程时才有价值。

### NeurIPS — Guidelines for Talks

<https://neurips.cc/Conferences/2021/PaperInformation/Author-Guidelines>

可提炼：

- 少文字、大字号；
- 粗体用于真正强调；
- 高对比；
- 不依赖颜色单独传递含义；
- 考虑色觉无障碍。

### Simon Peyton Jones — How to Give a Great Research Talk

<https://simon.peytonjones.org/great-research-talk/>

可提炼：

- talk 的目标不是把论文全文复述一遍；
- 核心思想和直觉通常比细节堆积更重要；
- 示例和故事推进比按 paper section 念更适合演讲。

### Jure Leskovec — Thesis Defense

<https://cs.stanford.edu/people/jure/pubs/thesis/jure-defense_pdf.pdf>

不照抄其具体视觉，而学习：

- 大标题建立清楚层级；
- 逻辑转折可以直接可视化；
- 数据图与结论并置；
- 大型问题地图适合做章节导航，但不应滥用。

### Chris Ré — NeurIPS 2023 Keynote

<https://cs.stanford.edu/people/chrismre/papers/NeurIPS23_Chris_Re_Keynote_DELIVERED.pdf>

可提炼：

- 学术 deck 可以有强页面节奏；
- 章节切换、单句问题页、局部大图可以增强叙事；
- 视觉冲击最终仍要服务研究论点，而不是品牌展示。

## 七条统一原则

### 1. Message first

先写这一页要让观众记住什么，再选图和布局。

没有明确 message 的页先不要做。

### 2. Evidence is the hero

学术 PPT 的视觉主角应该是：

- 论文 Figure；
- 实验结果；
- 机制图；
- 数学关系；
- 经核验的数字。

装饰永远排在后面。

### 3. Adapt, don't paste

论文适合阅读，PPT 适合观看。

Figure 应根据讲述需要：

- 裁；
- 拆；
- 放大；
- 标注；
- 分页聚焦。

而不是整张截图缩小。

### 4. One visual hierarchy

观众应该快速知道：

1. 先看哪里；
2. 再看哪里；
3. 最后得到什么结论。

不要让所有元素同等突出。

### 5. Story beats chronology

汇报不必严格按论文目录顺序。

更常见的有效顺序是：

```text
问题
→ 为什么难
→ 核心观察
→ 怎么做
→ 证据
→ 局限
```

### 6. Restraint signals scholarship

学术感来自可信、克制和清楚。

“丰富”不等于营销化；“简约”也不等于空。

简化应减少单页负担，不能删掉理解创新所需的步骤。每篇论文都需要把“旧方法的问题 → 本文具体改动 → 运作原理 → 验证证据 → 尚存局限”讲完整；需要时增加页数。创新不能用模块清单、论文摘要或总体成绩代替。

机制页先建立输入输出，再沿原图解释关键步骤与改动。涉及公式时解释符号及操作直觉；复杂方法分多页聚焦。正文要出现实际机制，备注负责展开成口头讲解，不能让学生只凭图名猜原理。区分既有技术、本篇新增贡献和作者尚未证实的解释。

原图是证据，页内编号、文字和明确标示的教学例子负责引导阅读。实验页回答“这个实验支持哪项创新”，整体成绩和组件消融分开。对于基准论文，解释数据怎样构造、哪些因素被控制、为什么能揭露旧评测遗漏的问题。

### 7. Visual AI is an editor

视觉模型不只是最后检查溢出。

它应该参与：

- 选图；
- 判断图是否适合讲；
- 决定裁剪；
- 规划阅读路径；
- 发现信息过载；
- 重新排版；
- 对照论文检查视觉是否误导。

## 不应该从参考中继承的东西

- 学校/公司的固定模板；
- 具体品牌配色；
- 小字号；
- 重描边；
- 3D 效果；
- 过时动画；
- 因为 keynote 用黑底就把黑底理解成“高级”；
- 因为某套 deck 有大图就强行给每篇论文加装饰图。

参考的价值是理解**为什么有效**，不是复制**长什么样**。

## 交付给 Paper2Talk

逐页输出 approved-style.md 定义的 design 字段。原图的具体裁切、编号框、创新对照行、重点概念和实验数值比较都必须落到字段中；这些字段决定原生 PPT 的页型与分步动画。文本摘要用于支持画面，不能替代画面组织。
