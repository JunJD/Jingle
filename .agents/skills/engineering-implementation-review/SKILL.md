---
name: engineering-implementation-review
description: Review engineering implementations for layering, maintainability, and architectural hygiene before they land.
allowed-tools: Read, Grep, Glob
user-invocable: true
---

# Engineering Implementation Review

在审查实现质量、代码结构、分层边界，或判断一个改动是否适合落地时使用这个 skill。

## 核心审查目标

1. 保持架构边界清晰
2. 保持业务逻辑可读
3. 防止临时兼容性 hack 固化为长期设计
4. 抓出“局部现在能跑”但会持续制造债务的实现
5. 审查哪些问题属于业界通用问题；对这些问题优先复用成熟实现，禁止无理由造轮子

## 主要规则：业界通用问题优先找现成实现，绝不无必要造轮子

遇到以下类型的问题时，必须先审查当前实现是不是在重复发明已有方案：

- diff / patch 解析与渲染
- markdown 渲染
- 代码高亮
- 表格、树、虚拟列表
- drag and drop
- 表单校验
- schema / codec / parser
- 状态机、命令编排、缓存、重试
- 文件预览、媒体预览、URL 解析
- Electron / React / Radix / Prisma / LangChain 生态里已有成熟模式的问题

审查要求：

- 先判断这个问题是不是行业内已有稳定解法
- 如果已有成熟库、官方推荐模式、现成组件或仓库内已存在实现，优先复用
- 只有在存在明确约束时，才接受自定义实现
- “明确约束”必须具体可验证，例如：
  - 现成实现无法满足当前数据模型
  - 现成实现引入不可接受的体积、性能或安全代价
  - 现有依赖和运行环境不兼容
  - 产品交互有明确差异，复用成本高于自研成本

以下情况要直接作为审查问题指出：

- 通用问题手写 parser / renderer / cache / adapter，但没有说明为什么不能复用成熟实现
- 仓库里已经有可复用实现，却在新文件里又写了一套近似逻辑
- 用 100 行自定义代码替代一个成熟、已验证的基础能力，却没有收益说明
- 明明是生态层问题，却在业务层硬写一套“轻量版”

输出时要明确说明：

- 这是不是一个业界通用问题
- 当前实现是否在造轮子
- 更合适的现成实现候选是什么
- 为什么当前自定义实现不成立，或在什么约束下才成立
- 这个问题是否阻塞合入

## 硬规则：不要把解析辅助逻辑藏进业务文件

如果一个文件的主要职责是业务编排、中间件接线、服务流程或 UI 行为：

- 不要在这个文件内联低层级的 parsing / coercion helper
- 不要把 `optionalNullableString`、`requireString`、`asX`、`normalizeY` 之类 helper 埋在业务流程旁边，除非这个文件本身就是 parser / codec 层
- 不要把输入解码和领域行为写进同一个实现单元

应优先改为：

- 把输入解析移到独立的 parser / schema / codec 模块
- 让业务文件只依赖已经解析完成的 typed input
- 让编排文件只关注流程，而不是临时字符串修补和对象兜底

### 典型异味

以下情况都应被点名指出：

- middleware 文件不断堆积 `requireString` / `optionalString` / `optionalNullableString`
- service 文件把持久化流程和原始 payload coercion 混在一起
- UI 组件内部带 data-shape repair helper
- tool registration 文件同时承担 request decoding、validation、normalization 和业务执行

### 推荐落点

- `*-parser.ts`
- `*-schema.ts`
- `*-codec.ts`
- `normalizers.ts`

业务文件应当读起来像：

1. 接收 typed input
2. 调用 domain / service logic
3. 返回结果

而不是：

1. 修字符串
2. 补 nullability
3. 猜对象 shape
4. 临时校验
5. 最后才执行业务逻辑

## 输出要求

- 审查结论一律使用中文
- 先给 findings，按严重程度排序
- 每条 finding 都要写清：
  - 具体文件
  - 失败模式或实现风险
  - 为什么这件事重要
  - 最小修正方向
- 如果问题属于“在造轮子”，必须明确写出它是通用问题，以及优先复用什么
- 只有在影响结论时，才补 open questions / assumptions
