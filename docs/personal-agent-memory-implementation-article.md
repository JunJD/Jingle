# 我们是怎么把 Agent 记忆从“会记住”做成“可信任”的

做 Agent 记忆时，最容易被误导的问题是：“怎么让它记住更多东西？”

Openwork 这次做个人记忆，真正绕了一圈后发现，重点不是记住更多，而是让用户知道：

- 它准备记什么。
- 什么内容已经生效。
- 这轮回答到底用了哪些记忆。
- 记错了在哪里改。
- 工作区切换、resume、规则文件和个人偏好之间的边界在哪里。

这篇不是一份 API 文档，而是一次产品和工程决策复盘。我们过程中调研了很多 Agent 产品和框架，也遇到了几个容易做错的决策点。最终 V1 选择了一条比较克制的路线：**写入要确认，读取要举证，归属要稳定，存储要本地优先。**

<!--
IMAGE_PLACEHOLDER_01
建议位置：文章开头主视觉。
用途：表达“Agent 记忆不是黑盒，而是可见的状态机”。
Prompt：
一张高级产品技术文章封面图，主题是“可信任的 Agent 记忆系统”。画面中心是一条清晰的记忆状态链路：Pending Suggestion -> Active Memory -> Included Memory，周围有桌面应用界面、用户确认按钮、数据库节点和运行时上下文流。风格克制、现代、Apple/Linear 风格，浅色背景，细线框、轻微阴影、蓝灰色和绿色点缀，不要卡通，不要夸张科幻，不要人物脸，适合中文技术博客头图，16:9。
-->

## 一开始我们差点把重点放错

最初的需求听起来很简单：让 Agent 能总结每天 GitHub 热点项目，并站在个人视角形成记忆。

但很快我们发现，GitHub 不是重点。真正的问题是“记忆”本身：

- 什么东西应该被长期记住？
- 谁来决定它可以被记住？
- 它是个人全局记忆，还是当前工作区上下文？
- 它应该存在本地文件、SQLite，还是未来同步到服务器？
- 如果用户换了 workspace，旧 session 里的记忆还能不能写入当前 workspace？

这些问题不解决，哪怕模型能自动总结很多内容，用户也不会真正信任它。

于是我们把需求收缩成一个更底层的问题：**如何设计一个个人 Agent 记忆系统，让它在产品心智和工程边界上都站得住。**

## 调研后得到的几个结论

我们看了几类主流实践。

消费级助手，比如 ChatGPT、Gemini，更强调“用户能看见和管理 saved memory”。它们的重点不是暴露底层结构，而是让用户知道哪些内容被保存了，可以删除，也可以关闭记忆。

代码 Agent，比如 Claude Code、Cursor、Windsurf、Gemini CLI、Kiro、Cline、Continue，更强调规则文件和工作区上下文。它们普遍会把用户规则、项目规则、目录上下文、session resume 分开处理。

Agent 框架，比如 LangGraph、DeepAgents、OpenAI Agents SDK、Vercel AI SDK，更关注 middleware、session、context injection、tool interception、state persistence 这些技术插槽。

调研下来，有几个结论很明确。

第一，长期记忆不能静默写入。自动发现候选可以，但 active memory 最好有用户确认，至少要有清晰管理入口。

第二，个人记忆和规则文件不是一种东西。`AGENTS.md`、`soul.md`、workspace rules 更像 instruction source；“用户叫丁俊杰”“默认中文回复”“做技术方案前先说边界”才是结构化个人记忆。

第三，workspace 归属不能靠当前 UI 状态直接落库。前端当然知道用户当前在哪个界面，但 session 可以 resume，workspace 可以切换，run 的原始 workspace 和当前窗口 workspace 可能不一致。最终归属要由 main process 固化和校准。

第四，记忆要能解释。用户不只想知道“它答对了”，还想知道“它为什么知道”。

<!--
IMAGE_PLACEHOLDER_02
建议位置：“调研后得到的几个结论”之后。
用途：展示不同产品实践如何汇聚到 Openwork 的 V1 方案。
Prompt：
一张技术调研信息图，左侧分三组来源：Consumer Assistants（ChatGPT, Gemini）、Coding Agents（Claude Code, Cursor, Windsurf, Gemini CLI, Kiro）、Agent Frameworks（LangGraph, DeepAgents, OpenAI Agents SDK, Vercel AI SDK）。三组箭头汇聚到右侧 Openwork Memory V1，右侧列出四个原则：Visible, Confirmed, Scoped, Auditable。极简信息架构图，浅色背景，细线箭头，现代 SaaS 文档风格，文字清晰可读，16:9。
-->

## 第一个关键决策：pending 不是 active

记忆产品里最危险的一句话是：“我记住了。”

模型很容易在当前对话里说“好的，我记住了”，但这不代表系统真的把它写成了长期状态。用户听到这句话，会自然以为新 session 也应该知道。如果下一轮 Agent 又说不知道，用户会觉得整个记忆系统不可信。

所以 V1 把记忆拆成三个状态：

```text
pending suggestion -> active memory -> included memory
```

| 状态 | 用户含义 | 工程含义 |
|---|---|---|
| pending suggestion | Agent 建议记住，但还没生效 | `AgentMemorySuggestion.status = pending`，不进入 prompt |
| active memory | 用户已经批准，长期生效 | `AgentMemory.status = active`，可被运行时读取 |
| included memory | 本轮回答实际用了哪些记忆 | `AgentMemoryInclusion`，按 run 记录使用证据 |

这不是数据库状态的炫技，而是用户心智的分层。

当用户说“记住我叫丁俊杰，也叫 alading”时，Agent 只能生成 pending suggestion。用户点保存以后，它才变成 active memory。下一轮 run 构建 prompt 时，active memory 才会被注入。

所以我们后来在 UI 里做了两张卡片：

- **待确认记忆**：这是准备写入，还需要用户批准。
- **本轮纳入了 N 条记忆**：这是已经生效，并且这轮回答实际读取了。

一句话概括：

```text
待确认记忆 = 写入前确认
本轮纳入记忆 = 读取时举证
```

这两个卡片一出来，整个记忆系统的心智就顺了。用户不再需要猜测“它到底有没有真的记住”，因为系统把写入和读取都变成了可见证据。

<!--
IMAGE_PLACEHOLDER_03
建议位置：“第一个关键决策：pending 不是 active”之后。
用途：解释 pending/active/included 三段式状态机。
Prompt：
一张清晰的产品状态机图，展示 Agent Memory 的三段状态：Pending Suggestion、Active Memory、Included Memory。Pending 下方有 Save / Ignore 按钮，Active 下方有 editable local database 图标，Included 下方有 chat answer with evidence 图标。三段之间用细箭头连接，整体像高质量产品设计文档中的流程图，浅色背景，圆角矩形，绿色表示确认，灰色表示只读证据，不要复杂装饰，16:9。
-->

## 第二个关键决策：记忆不是规则文件

Openwork 原来已经有 DeepAgents 的 `createMemoryMiddleware`。从名字看，它像是“记忆”。但进一步看实现，它更像是在读取 `AGENTS.md`、workspace rules、用户配置的 instruction sources。

这就产生了命名和产品语义冲突。

用户理解的“记忆”是：

- 我是谁。
- 我偏好什么。
- 我纠正过 Agent 什么。
- 当前工作区有什么长期上下文。

而 `AGENTS.md` 或 `soul.md` 更像规则和长期指令：

- 代码风格。
- 工程边界。
- Agent 行为原则。
- 项目约束。

它们都可能进入 prompt，但它们不是同一种数据。

所以 V1 没有继续把 DeepAgents 的 `createMemoryMiddleware` 包装成 Openwork 的产品记忆，而是新增了 Openwork 自己的 memory 模块：

```text
createOpenworkMemoryMiddleware
  -> 读取规则文件和 instruction sources
  -> 读取结构化 active memory
  -> 注入 OpenworkMemoryContextPack
  -> 暴露 suggest_personal_memory 工具
```

底层来源继续分区：

| 来源 | 存储 | 产品语义 |
|---|---|---|
| `AGENTS.md` / rules | 文件 | 工程规则、可版本控制、可跨 Agent 共享 |
| `soul.md` | 文件 | 长期气质、原则、人设层 |
| structured memory | Prisma / SQLite | 用户确认过的个人事实、偏好、纠正 |
| pending suggestion | Prisma / SQLite | 待确认候选，不进入 prompt |

这也是为什么我们在 `AGENTS.md` 里加了存储规则：即使当前 Prisma/SQLite 和文件都在本机，它们的性质也不同。文件适合可读和迁移；结构化表适合确认流、审计、查询、删除和 inclusion 记录。

## 第三个关键决策：workspace 可以由前端表达，但不能由前端裁决

这个点过程中争论比较多。

一个直觉是：workspace 首先是前端概念，用户在 UI 里切换 workspace，为什么不能由前端传给后端？

答案是：可以传，但只能作为 claim。

问题不在“前端有没有状态”，而在“状态是否足以成为持久化 authority”。在桌面 Agent 里，会出现这些特殊情况：

- 同一个 session 被 resume，但当前窗口已经切到另一个 workspace。
- 用户在 workspace A 里产生 pending memory，尚未保存时切到 workspace B。
- 当前 UI 显示的 workspace 和 thread/run 创建时固化的 workspace 不一致。
- 未来多个 worktree 或 project 可能共享一部分上下文，但 V1 还没有 project 概念。

如果前端传什么，后端就写什么，很容易把一条原本属于 workspace A 的记忆写进 workspace B。

V1 的策略是：

- renderer 传递交互现场，例如当前 thread、当前选择的 workspace、用户点击保存的时刻。
- main process 根据 thread metadata、规范化路径、run snapshot 计算最终 workspace identity。
- suggestion 默认保留来源 workspace。
- 如果 thread 还有 pending workspace memory suggestion，先不允许切换该 thread 的 workspace。

这个方案不复杂，但它解决了一个真实风险：pending 期间工作区漂移。

我们没有在 V1 里提前发明 project 抽象。当前产品还没有 project 概念，所以 `workspaceKey` 先用 main process 规范化后的本地路径。未来如果要把多个 worktree 归到一个 project，应该做显式迁移，而不是现在暗中合并。

<!--
IMAGE_PLACEHOLDER_04
建议位置：“第三个关键决策：workspace 可以由前端表达，但不能由前端裁决”之后。
用途：展示 renderer claim 和 main authority 的关系。
Prompt：
一张架构流程图，标题是 Workspace Claim vs Main Authority。左侧是 Renderer UI，发出 workspace claim；中间是 Main Process，包含 normalize path、thread metadata、run snapshot、workspace identity resolver；右侧是 SQLite Memory Store 和 Agent Runtime。箭头显示 renderer claim 进入 main，main resolved identity 才能写入 memory store 和 runtime context。图中突出“claim is input, resolved identity is authority”。风格清爽专业，适合工程博客，16:9。
-->

## 第四个关键决策：普通记忆不用同步 HITL

另一个容易走偏的问题是：既然要用户确认，那是不是应该做成 human-in-the-loop，中断 Agent run，等用户批准？

V1 没这么做。

原因是普通个人记忆不是高风险工具行为。它不应该像修改文件、执行命令、访问敏感资源那样阻塞运行。更自然的交互是：Agent 先完成回答，然后在回答下方给出候选记忆卡片，用户可以顺手保存或忽略。

这其实也是产品节奏问题。

用户在读回答时，看到“待确认记忆”，这是一种轻量后处理。如果每次说“记住我的偏好”都弹出阻塞审批，记忆会变得很烦。

所以 V1 把普通记忆设计成异步 pending review，把真正高风险的东西留给同步 HITL，例如：

- 修改文件型规则。
- 写入 `AGENTS.md` 或 `soul.md`。
- 执行命令。
- 保存敏感信息。

这样，记忆既不是静默写入，也不是过度打断。

## 实现后的链路

最后落到实现，完整链路是这样的：

```text
用户表达偏好
  -> Agent 调用 suggest_personal_memory
  -> main 写入 AgentMemorySuggestion(pending)
  -> renderer 显示 MemoryReviewPanel
  -> 用户点击保存
  -> main 转成 AgentMemory(active)
  -> 下一轮 run 构建 OpenworkMemoryContextPack
  -> middleware 注入 prompt
  -> run 完成后记录 AgentMemoryInclusion
  -> renderer 显示 IncludedMemoriesPanel
```

模块边界也按这个链路拆开：

| 模块 | 职责 |
|---|---|
| `src/main/db/agent-memory.ts` | 结构化记忆、候选建议、inclusion 的数据库读写 |
| `src/main/openwork-memory/service.ts` | 记忆业务规则、context pack 构建、接受/拒绝 suggestion |
| `src/main/openwork-memory/middleware.ts` | 运行时 prompt 注入和 `suggest_personal_memory` 工具 |
| `src/main/openwork-memory/controller.ts` | memory IPC controller |
| `src/preload/api/memory.ts` | `window.api.memory` |
| `src/shared/openwork-memory.ts` | 前后端共享类型 |
| `src/renderer/src/components/chat/MemoryReviewPanel.tsx` | 待确认记忆卡片 |
| `src/renderer/src/components/chat/IncludedMemoriesPanel.tsx` | 本轮纳入记忆卡片 |
| `src/renderer/src/settings/MemoryTab.tsx` | 设置页记忆管理 |

这里有一个重要边界：renderer 不决定长期记忆归属；runtime middleware 不直接写 active memory；DB 层不包含产品判断。真正的业务规则收在 main service 里。

<!--
IMAGE_PLACEHOLDER_05
建议位置：“实现后的链路”之后。
用途：展示端到端写入和读取链路。
Prompt：
一张端到端系统链路图，展示从用户输入“记住我...”到 Agent tool suggest_personal_memory，再到 Main Service、SQLite pending suggestion、MemoryReviewPanel、用户点击 Save、Active Memory、下一轮 OpenworkMemoryContextPack、Agent Runtime、IncludedMemoriesPanel。要求每个节点像产品架构图，箭头清晰，使用两种颜色区分写入链路和读取链路。浅色背景，专业工程文档风格，16:9。
-->

## 真正暴露问题的是一次手测

我们第一次跑通后，用户说：

> 记住：我以后希望你默认用中文回答；我叫丁俊杰，也叫 alading。

Agent 调用了 `suggest_personal_memory`，也回复了类似“我都记住了”。但新开一个 session 问“我是谁”，它却回答不知道。

这看起来像后端记忆没写进去。实际查下来不是。

当时 DB 里有 pending suggestion，但没有 active memory。主聊天页已经有审核卡片，但 Launcher AI 页面没有渲染 `MemoryReviewPanel`。结果是：工具成功生成了候选记忆，但用户没有看到“需要确认保存”这一步。

这就是记忆系统里最典型的断点：后端状态正确，但 UI 没把状态讲完整，用户心智就断了。

修复很小：

- `LauncherAiPage` 从 thread state 读取 `runId`。
- `LauncherAiConversation` 复用 `IncludedMemoriesPanel` 和 `MemoryReviewPanel`。

修完后再测试：

- 先看到“待确认记忆”。
- 点保存后变成 active memory。
- 新 session 问“我是谁”，模型回答“你是丁俊杰，也叫 alading”。
- 回答下方出现“本轮纳入了 2 条记忆”。

这次手测直接验证了我们的核心判断：记忆系统不是只要数据写对就行，必须把状态展示出来。

## 另一个基础问题：run 不能卡在 loading

做记忆时还顺手暴露了一个运行时生命周期问题：有些 run 会卡在“Agent 正在思考”。

这和记忆模块不是同一个问题，但它会直接破坏记忆体验。因为 pending card 是 run 结束后的后处理 UI。如果 run 一直 busy，用户就永远看不到待确认卡片。

这次一起修了两件事：

- app 启动时恢复陈旧的 running run / busy thread，标记为 interrupted。
- title middleware 避免在 assistant message 仍有 pending tool call 时抢先生成标题，并给标题生成加短超时。

这件事提醒我们：Agent 记忆不是一个孤立功能，它依赖 run 状态机、stream lifecycle、tool call、title generation、thread persistence 全部稳定结束。

## 我们最后留下的原则

这次实现之后，Openwork 的个人记忆 V1 基本形成了几条原则。

第一，记忆默认本地优先。未来可以同步，但同步只能是用户显式开启的备份或跨设备层，不能改变本地数据作为主权源的语义。

第二，Agent 可以建议记忆，但不能静默生效。pending suggestion 是产品边界，不是技术细节。

第三，记忆读取必须可解释。Included memories 让用户知道本轮回答用了什么，而不是让模型神秘地“知道”。

第四，规则文件和结构化记忆必须分开。它们都能进 prompt，但存储、权限、编辑方式和用户心智不同。

第五，workspace 归属要由 main process 校准。前端表达现场，后端决定 authority。

第六，普通记忆确认不打断 run。异步审核足够，高风险行为才进入同步 HITL。

第七，UI 是记忆正确性的一部分。少一个卡片，用户就会误解系统状态。

## 为什么这个 V1 值得先做小

我们没有在 V1 里做向量数据库、复杂去重、自动合并、历史批量总结、服务器同步、多 project 归并。

这些都可能有价值，但它们不应该出现在第一步。

第一步真正需要证明的是：

```text
用户要求记住
-> 系统生成候选
-> 用户确认保存
-> 新 session 能读到
-> UI 展示本轮使用了哪些记忆
-> 用户可以管理和删除
```

这个闭环成立以后，后续能力才有基础。

否则，功能越自动，用户越不确定；记忆越多，越难信任。

我们最终得到的不是一个“更聪明的自动记忆器”，而是一个更可审计的个人上下文系统。

这可能是 Agent 记忆最该先解决的问题。

