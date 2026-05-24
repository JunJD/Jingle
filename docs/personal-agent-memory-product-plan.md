# 个人 Agent 记忆产品方案

## 定位

个人 Agent 记忆是 Openwork 的长期个人上下文层，用来保存用户希望 Agent 持续记住的偏好、工作方式、当前工作区事实和纠正记录。

V1 的目标不是自动理解一切历史，也不是做信息流推荐系统，而是让用户明确知道三件事：

- Agent 记住了什么。
- Agent 为什么会用这些记忆。
- 用户可以随时新增、修改、删除或临时关闭记忆。

记忆默认本地优先，存放在本机 Openwork 数据目录中。未来可以增加可选同步或备份，但同步不能改变“本地数据是用户主权数据”的产品默认。

## 参考实践

主流 Agent 产品的记忆实践可以压缩成三个产品约束：

- ChatGPT、Gemini 类产品强调用户可见、可管理、可关闭的个人记忆。
- Claude Code、Cursor、Windsurf 类工具把规则文件、工作区指令和自动记忆分开，避免把可执行规则和个人事实混成一个入口。
- LangGraph、Letta、Mem0 类框架把长期记忆视为结构化状态，要求显式读写、可检索、可追踪来源。

Openwork V1 采用“统一运行时上下文、分区存储、可见可控、本地优先”的方案，不做静默自动记忆。

参考来源：

- [OpenAI Memory FAQ](https://help.openai.com/en/articles/8590148-memory-faq)
- [Claude Code Memory](https://docs.anthropic.com/en/docs/claude-code/memory)
- [Claude Code Sessions](https://code.claude.com/docs/en/how-claude-code-works)
- [OpenAI Codex CLI issue: resume cwd drift](https://github.com/openai/codex/issues/4791)
- [Cursor Rules](https://docs.cursor.com/en/context)
- [Cursor Memories](https://docs.cursor.com/en/context/memories)
- [Windsurf Memories](https://docs.windsurf.com/windsurf/cascade/memories)
- [Rovo Dev CLI Sessions](https://support.atlassian.com/rovo/docs/manage-sessions-in-rovo-dev-cli/)
- [Gemini CLI GEMINI.md](https://google-gemini.github.io/gemini-cli/docs/cli/gemini-md.html)
- [Gemini CLI Commands](https://google-gemini.github.io/gemini-cli/docs/cli/commands.html)
- [Kiro Steering](https://kiro.dev/docs/cli/steering)
- [VS Code Copilot Custom Instructions](https://code.visualstudio.com/docs/copilot/customization/custom-instructions)
- [Cline Rules](https://docs.cline.bot/customization/cline-rules)
- [Cline Multi-Root Workspaces](https://docs.cline.bot/features/multiroot-workspace)
- [Continue Rules](https://docs.continue.dev/customize/deep-dives/rules)
- [LangGraph Memory](https://docs.langchain.com/oss/python/concepts/memory)

## 实践结论

当前市面实践不是“把聊天历史自动总结后全部记住”，而是走向分层和可控：

- 消费级助手把 saved memory、chat history 和 temporary chat 分开，让用户可以查看、删除、关闭。
- 代码 Agent 把规则文件、目录级上下文、用户偏好和自动学习分开；越稳定、越需要团队复用的内容，越适合写成规则文件或 `AGENTS.md`。
- 自动记忆可以存在，但保存前要有用户确认，或至少有明确的管理入口和删除入口。
- 长期记忆必须有作用域。全局偏好、当前工作区上下文、纠正记录不能混成一类。
- 对代码 Agent 来说，文件型上下文适合放规则、原则、流程；结构化存储适合放可查询、可审计、可删除的个人记忆对象。

因此 Openwork V1 采用保守方案：Agent 可以发现候选记忆，但不能静默保存为 active memory。

## 工作区与 Resume 结论

当前工作区记忆不能只靠前端传入的 `workspaceKey` 落库。主流产品的共同做法是：用户可以在 UI、CLI 或 IDE shell 中选择当前目录、workspace 或 session；运行时再把这个选择固化到 session/run metadata，并在 resume 时校验。也就是说，前端需要表达当前交互现场，但最终用于记忆持久化、resume 和工具权限的 workspace identity 必须由 main process 校准后生成。

| 产品 | 做法 | 对 Openwork 的启发 |
|---|---|---|
| Claude Code | session 绑定当前目录；`/resume` 默认显示当前 worktree 的 session，可扩展到其他 worktree/project；`CLAUDE.md` 从 cwd 层级加载 | UI/CLI 可以触发选择，但 session 归属要被 runtime 固化；resume 必须知道原始目录 |
| OpenAI Codex CLI | 社区 issue 指出从不同 cwd resume 会导致工具 workdir 和 sandbox root 漂移，应恢复或提示原 cwd | silent workspace rebind 是安全和数据归属问题 |
| Rovo Dev CLI | session tied to specific workspace；当前 workspace 只看到自己的 sessions；restore 从当前工作目录恢复 | session 列表和恢复入口应该按 workspace 分区 |
| Gemini CLI | saved chats 存在 `~/.gemini/tmp/<project_hash>/`；只能在同一 project 下 resume；`GEMINI.md` 按当前目录到项目根加载 | 本地 session 和上下文文件都需要稳定 root identity |
| Kiro | CLI session 可按当前目录列出；`.kiro/steering` 分 global/workspace；multi-root 时展示每个 root 的来源 | V1 不做 project 概念时，必须明确“当前工作区”是单一 root |
| Cursor | Memories project-scoped，保存前需要用户批准；Rules 分 user/project | 自动记忆和规则都要有产品定义的 scope |
| Windsurf | Memories 关联创建时 workspace，其他 workspace 不可见；durable knowledge 建议写 Rules 或 `AGENTS.md` | workspace memory 必须隔离，团队规则另走文件 |
| VS Code Copilot | workspace root 自动加载 `.github/copilot-instructions.md`，并能在 References 中看见来源 | 上下文来源要可解释、可追踪路径 |
| Cline / Continue | rules 放在 `.clinerules/`、`.continue/rules` 等 workspace 文件夹；Cline 明确说明 multi-root 限制 | V1 不承诺复杂 multi-root 语义，先保证单 workspace 正确 |

Openwork V1 的产品结论：

- `Current workspace` 是用户当前交互 workspace claim 与 main 固化 thread/run identity 对齐后的结果，不是设置页里的普通筛选条件。
- renderer 需要传递交互现场，例如 `threadId`、当前选中的 workspace、用户选择的 resume 动作和时间点；这些字段是 claim/hint，不是可直接落库的 authority。
- main process 根据线程 metadata、规范化路径、run snapshot 和当前窗口 workspace 计算最终 identity；结构化记忆、resume 和工具权限只使用 main-resolved identity。
- claim 与 main-resolved identity 一致时直接继续；不一致时进入冲突 UE，不能静默改绑，也不能静默落库。
- resume 时如果当前工作区和 session 原工作区不同，必须提示用户选择，不能静默继续。
- 如果用户想在另一个工作区继续旧对话，应使用 fork，而不是 resume 原 run。
- 未来有 project 概念后，可以把多个 workspace/worktree 映射到同一个 project；V1 不提前做这个抽象。

## 前后端协作与冲突 UE

Openwork 应该把 workspace 当成一个前后端协议：前端表达“用户此刻认为自己在哪里操作”，main 返回“系统确认后这次操作实际属于哪里”。问题不是前端能不能传 workspace，而是前端传来的 workspace 只能作为 claim，被 main 校准、纠错和回写到 UI。

| 场景 | Renderer 表达 | Main 决定 | UE |
|---|---|---|---|
| Composer 当前状态 | 当前 thread、窗口选择的 workspace、memory/temporary 状态 | 规范化 workspace identity，写入或读取 thread 绑定 | Composer footer 显示 workspace chip；identity 变化时原地刷新 |
| 生成候选记忆 | 来源 thread/run、来源 workspace、建议 scope、候选内容 | 候选记忆的 source workspace 和 proposed scope | 卡片显示来源，不立即写入 active memory |
| 接受候选记忆 | suggestion id、用户选择的保存目标、当前 workspace claim | 保存到来源 workspace、当前 workspace 或 global；实际 `workspaceKey` | 当前 workspace 与来源不同时，卡片显示两个 workspace，让用户明确选择 |
| Resume session | 目标 run、当前 workspace claim、用户选择的动作 | 原 run snapshot 与当前 identity 是否一致 | 不一致时展示选择面板：回到原工作区、在当前工作区 fork、只查看历史、取消 |
| 设置页筛选 | 用户选择 `Global` 或 `Current workspace` tab | 当前窗口/workspace 对应的可读范围 | tab 标题旁显示当前 workspace 名称；切换 workspace 后列表随 main 返回结果更新 |

冲突状态必须靠近触发对象，而不是只发 toast：

- `MemoryReviewCard` 上的 workspace 差异不是默认错误。候选记忆属于 source workspace；用户当前可能已经切到另一个 workspace。卡片要显示 `Suggested in A` 和 `You are in B`，主按钮默认保存到来源 workspace，次按钮允许显式保存到当前 workspace 或改成 global。
- 只有当用户选择“保存到当前 workspace”但 claim 与 main-resolved current workspace 不一致时，才是 mismatch；此时不落库，保留卡片并提示刷新。
- `MemoryTab` 上的 stale workspace claim：保留当前筛选，显示当前 main-resolved workspace chip，并提供 `刷新`。
- `Resume` mismatch：保留原 session 信息和当前 workspace 信息，用户必须选择一个明确动作。
- 所有冲突都要保留 pending 状态，不能因为检测 mismatch 就清掉可操作入口。

## UI/UE 参考结论

主流产品里值得借鉴的不是视觉样式，而是交互结构：

| 产品 / 研究 | 值得借鉴 | Openwork 取舍 |
|---|---|---|
| ChatGPT Memory | 设置里可以查看、搜索、删除 saved memories；Temporary Chat 明确切断记忆读写 | 保留“可见、可删、临时模式”，但不做静默 active memory |
| Claude Code `/memory` | 记忆/规则文件可直接打开编辑，强调作用域和 markdown 可读性 | `soul.md`、`AGENTS.md`、规则文件提供打开/显示入口，不塞进结构化记忆表 |
| Cursor Memories | 自动提取候选、需要用户批准；入口在 Settings / Rules | 普通记忆进入 pending review，不打断当前 run |
| Windsurf Memories & Rules | Memories 和 Rules 同入口管理，但明确建议 durable knowledge 写入 Rules 或 AGENTS.md | Openwork 也统一 runtime context，但在 UI 中分区展示来源 |
| Memory Sandbox | 把记忆当作可查看、可操作、可分享的数据对象 | active memory 和 pending suggestion 都必须是可编辑对象 |

V1 的 UX 核心不是“自动记得更多”，而是让用户形成稳定心智：

- 这次有没有用记忆。
- 哪些记忆被放入了本次上下文。
- Agent 想新增什么记忆。
- 这些记忆在哪里改、哪里删、哪里临时关闭。

## V1 交互结构

V1 只做三个记忆交互面，不新增分散入口。

### 1. Composer 记忆状态

位置：聊天输入区底部，和模型、工作区、上下文使用量在同一行。

形态：

- 一个低噪声状态 chip，例如 `Memory on`、`Temporary`、`Memory off`。
- 点击打开小 popover，提供当前 run 的控制：
  - `Use memory for this run`
  - `Temporary run`
  - `Show included memories`
  - `Open Memory Settings`

行为：

- `Temporary run` 是当前 run 级别，不是全局默认。
- 切换后只影响下一次发送，不改变正在运行的 run。
- chip 只显示状态，不解释功能；详细管理放设置页。

### 2. 回答后的记忆反馈

位置：assistant 回答底部工具栏附近，不打断阅读。

包含两类反馈：

| 状态 | UI | 行为 |
|---|---|---|
| Included memories | 折叠行：`Included 3 memories` | 展开后显示本次注入上下文的 active memory，可跳转编辑或删除 |
| Suggested memory | 审核卡：候选内容 + reason + scope + source workspace | 用户可接受、编辑后接受、拒绝，或选择保存到来源 workspace、当前 workspace、全局 |

普通候选记忆不弹 modal，不阻塞当前回答，不进入 composer approval。只有高风险写入才走同步 HITL。

候选卡设计：

- 一张卡只审核一条候选记忆。
- 主体只显示候选记忆文本。
- 次级信息显示 reason、scope、来源 run。
- 主按钮通常是 `Save memory`。如果候选来源 workspace 与用户当前 workspace 不同，主按钮是 `Save to source workspace`，次按钮是 `Save to current workspace`、`Make global`、`Edit`、`Reject`。
- 保存成功后卡片就地变成 `Saved`，提供 `Undo` 或 `Open in settings`。

### 3. 设置页 Memory tab

设置页新增 `Memory` tab，采用管理台布局：

- 顶部：本地存储状态和三个开关。
- 中部：分段筛选。
- 主区域：列表和详情。

顶部开关：

| 设置 | 默认值 | 说明 |
|---|---:|---|
| Use memory | 开 | 控制 active memory 是否参与运行时读取 |
| Ask before saving | 开 | V1 固定开启，不提供静默保存 |
| Show included memories | 开 | 控制回答后是否展示 included memory 折叠行 |

分段筛选：

- `Pending`
- `About me`
- `Current workspace`
- `Corrections`
- `Context sources`

列表行为：

- `Pending` 默认排第一，因为它代表用户待处理的决策。
- active memory 支持搜索、按更新时间排序、按作用域过滤。
- 每条 memory 是一行：类型、作用域、内容、更新时间、最近使用时间、行内操作。
- 行内操作：编辑、归档、删除。归档优先，永久删除放在二级菜单。
- `Context sources` 展示 `soul.md`、`AGENTS.md`、instruction sources，只提供打开、显示路径、重新加载，不提供“保存为个人记忆”。

### 4. Resume 工作区确认

当用户恢复一个 session 时，Openwork 必须比较两个工作区：

- `session workspace`：thread/run 创建时由 main process 固化的工作区。
- `current workspace`：用户当前窗口或 launcher 选中的工作区。

如果两者一致，直接恢复。

如果两者不一致，显示一个轻量确认面板：

```text
这个 session 原本属于：
/old/workspace

你当前在：
/new/workspace
```

可选动作：

| 动作 | 行为 |
|---|---|
| 回到原工作区并恢复 | 切换到 session workspace，继续 resume 原 run |
| 在当前工作区 fork | 复制对话上下文，创建新 thread/run，使用当前工作区记忆和规则 |
| 只查看历史 | 打开 transcript，不允许继续执行工具、不写入记忆 |
| 取消 | 保持当前状态 |

V1 不提供“仍然用当前工作区强行 resume 原 run”。这会让同一段执行历史绑定到两个不同工作区，用户很难判断本次使用了哪些规则、记忆和文件权限。

## UE 原则

- 记忆反馈要靠近触发对象：回答产生候选，就在回答下方展示；设置修改就在行内反馈。
- 普通成功不发 toast。接受、拒绝、归档都在原卡片或原行里显示状态。
- destructive 操作优先提供 undo；不可撤销的永久删除才二次确认。
- keyboard-first：pending 队列要能用上下键切换，`Enter` 接受，`E` 编辑，`Backspace` 归档或拒绝前先聚焦确认。
- 列表行高度稳定，编辑态不挤压其他行；长文本用展开详情处理。
- 空状态只说明当前状态，不做营销式解释。
- 所有状态变化要在 100-200ms 内有本地反馈，异步失败再显示行内错误或 toast。

## V1 范围

V1 只保留三类记忆。

| 类型 | 范围 | 示例 | 用途 |
|---|---|---|---|
| About me | 全局 | 用户偏好中文回复、讨厌过度防御性编程 | 跨工作区的个人偏好和工作方式 |
| Current workspace | 当前工作区 | 这个工作区使用 Electron + React + Prisma | 只在当前工作区生效的上下文 |
| Corrections | 全局或当前工作区 | 用户纠正“不要把某类外部热点当作默认重点” | 防止 Agent 重复犯同类判断错误 |

V1 的范围只使用“全局”和“当前工作区”。所有与代码目录、产品资料、当前任务背景有关的范围都用“当前工作区”表达。

## 非目标

V1 不做：

- 自动从全量聊天历史中批量提取记忆。
- 向服务器同步记忆。
- 团队、组织或共享记忆。
- 向量数据库、知识图谱或复杂检索排序。
- 外部连接器导入记忆。
- 把规则文件、soul、Agent 配置、技能来源路径合并进结构化个人记忆表。
- 静默写入用户无法审查的记忆。

## 用户入口

设置页新增 `Memory` 入口，包含四个区域：

- `About me`：全局个人偏好和工作方式。
- `Current workspace`：当前工作区上下文。
- `Corrections`：用户纠正过的长期偏好或事实。
- `Pending memories`：等待用户确认的候选记忆。

聊天运行区域增加两个可见反馈：

- 本次回答注入了哪些记忆。
- 本次回答是否建议保存新的记忆。

临时模式是当前聊天或当前运行级别的开关，不是全局默认设置。开启临时模式后，本次运行不读取记忆、不写入记忆、不生成待确认记忆。

## 设置

V1 设置保持少而明确。

| 设置 | 默认值 | 行为 |
|---|---:|---|
| Use memory | 开 | 是否允许运行时读取已启用记忆 |
| Ask before saving | 开 | 新记忆必须进入待确认队列 |
| Show included memories | 开 | 在回答后展示本次注入上下文的记忆 |

不提供“自动静默保存”设置。用户主动说“记住……”也需要生成可编辑确认卡，而不是直接落库。

## 写入规则

记忆写入只有两个入口：

1. 用户主动要求保存，例如“记住我偏好中文回复”。
2. Agent 在被纠正后提出候选记忆，例如“是否记住：以后不要把某类外部热点当作默认重点”。

候选记忆必须进入 `Pending memories`。用户可以：

- 接受。
- 编辑后接受。
- 拒绝。
- 改成只在当前工作区生效。
- 当候选来源 workspace 与当前 workspace 不同时，明确选择保存到来源 workspace、当前 workspace 或全局。

敏感信息、凭据、密钥、隐私身份信息不能由 Agent 主动建议保存。用户显式要求保存时，也必须展示确认卡。

## 记忆保存流

普通记忆保存是异步确认，不是运行中断：

```text
Agent 发现候选记忆
  -> 写入 Pending memories
  -> 当前回答继续完成
  -> 回答后显示 memory review card
  -> 用户接受 / 编辑后接受 / 拒绝
  -> 接受后写入 active memory
  -> 下一次 run 生效
```

一个候选记忆对应一个明确决策。第一版不做批量接受、不做多条记忆合并确认，避免用户看不清 Agent 到底要记住什么。

## 何时生成候选记忆

候选记忆必须满足四个条件：

- 未来会复用，而不是只服务当前任务。
- 内容稳定，不是临时情绪、一次性指令或瞬时实现细节。
- 作用域明确，可以判断是全局还是当前工作区。
- 用户看见后能判断是否接受、编辑或拒绝。

V1 只在这些场景生成候选记忆：

1. 用户显式要求记住，例如“记住我偏好中文回复”。
2. 用户纠正了一个未来还可能重复出现的问题，例如“以后不要默认把外部热点当重点”。
3. 用户把某个当前工作区事实明确标记为长期上下文，例如“这个工作区后续都按 Electron + React + Prisma 理解”。
4. 同类纠正在多轮对话中重复出现，Agent 可以建议保存一条 correction。

V1 不从这些内容生成候选记忆：

- 当前任务指令，例如“这次只改文档”。
- 临时表达偏好，例如“这次短一点”。
- 普通聊天事实或外部链接。
- 代码里可以实时读取的事实，除非用户明确说它是长期上下文。
- secrets、tokens、账号、隐私身份信息。
- `soul.md`、`AGENTS.md`、规则文件内容。

候选记忆接受后才写入结构化个人记忆；生效时间是下一次 run 开始时。本次 run 的上下文包保持冻结，方便 resume 和审计。

## 读取规则

运行时在每次 run 开始时读取一份冻结的上下文包。上下文包包含文件型上下文和结构化个人记忆：

- `soul.md`。
- 全局和当前工作区规则。
- 用户配置的 instruction sources。
- 结构化个人记忆。

结构化个人记忆按当前线程所在工作区读取：

- 全局 `About me`。
- 当前工作区 `Current workspace`。
- 与当前工作区或全局相关的 `Corrections`。

记忆不是最高优先级指令。优先级从高到低：

1. 当前用户消息。
2. 安全和权限约束。
3. 临时模式。
4. 工作区规则和系统指令。
5. 个人记忆。

如果记忆与当前用户消息冲突，以当前用户消息为准，并在必要时提示用户是否更新记忆。

V1 不做向量检索。读取规则是确定性的：按类型、作用域、状态、更新时间选取少量 active memory。

## 记忆颗粒度

结构化个人记忆的最小单位是一条可独立判断真伪和作用域的事实或偏好。不要把一段聊天总结、多个偏好或一份规则文件塞进一条记忆。

推荐颗粒度：

| 类型 | 好的颗粒度 | 不好的颗粒度 |
|---|---|---|
| About me | 用户偏好中文回复 | 用户所有沟通偏好总结 |
| About me | 用户反感过度防御性编程 | 用户的工程风格 |
| Current workspace | 当前工作区使用 Electron + React + Prisma | 当前工作区技术栈、任务、路线图合集 |
| Correction | 讨论记忆设计时优先关注用户控制和记忆结构 | 上次那段对话总结 |

一条记忆应该满足：

- 一句话能表达清楚。
- 未来可复用。
- 可编辑、可删除。
- 有明确作用域。
- 不依赖某次聊天上下文才能理解。

## 本地与规则边界

个人记忆使用本地结构化存储，属于用户长期上下文。

`soul.md`、`AGENTS.md`、工作区规则、技能来源、外部指令来源属于长期上下文和能力配置，不属于结构化个人记忆。它们可以和个人记忆一起进入同一次 Agent 运行，但必须在产品入口、数据模型和运行时 prompt 中保持分区，避免用户无法判断“这是我的偏好”“这是工作区规则”还是“这是长期人格/原则层”。

## 验收标准

V1 完成时必须满足：

- 用户能在设置页看到、搜索、编辑、删除三类记忆。
- 用户能看到待确认记忆，并能接受、编辑、拒绝。
- 开启临时模式后，本次运行不读取、不写入、不建议记忆。
- Agent 回答后能展示本次注入上下文的记忆。
- 当前工作区记忆不会污染其他工作区。
- resume 到不同工作区时必须提示用户回到原工作区、fork、只查看历史或取消。
- 前端可以提交 workspace claim；接受候选记忆时必须带保存目标，实际归属由 main 校准并返回，不能因为用户切换 workspace 就静默改写候选来源归属。
- 文案和数据模型只使用全局和工作区两种作用域；涉及候选审核时，需要显示来源工作区和当前工作区两个具体目标。
- 记忆默认保存在本地，不需要服务器账号或同步能力。
