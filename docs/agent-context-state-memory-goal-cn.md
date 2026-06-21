# Agent Context State Memory V2 设计目标

## 背景

Openwork 当前已经有一套个人记忆 V1：

- `AgentMemory` 保存用户确认过的长期记忆。
- `AgentMemorySuggestion` 保存等待用户确认的候选记忆。
- `OpenworkMemoryContextPack` 在 run 开始前把文件型上下文和结构化记忆打包。
- `openworkMemory` middleware 把 context pack 注入 model context。
- `AgentMemoryInclusion` 记录某个 run 包含过哪些结构化记忆。
- `IncludedMemoriesPanel` 通过 `latestRunId` 查询 `memory.listIncludedMemoriesForRun` 展示 included memories。

V1 解决的是“Agent 不要忘记用户确认过的长期偏好和稳定事实”。它没有完整解决另一类问题：Agent 如何把 memory、history message、trace、artifact 当作可查询、可审计、可回显的运行时上下文。

V2 的目标不是替换 `AgentMemory`，而是新增一层运行时上下文关系：Agent 可以通过工具主动检索上下文；工具结果可以服务模型推理，但 UI 的事实源必须来自 runtime/schema state projection，而不是 tool message、live memory 表或 renderer 临时反推。

## 核心判断

上下文检索能力采用 `tool + schema state`，而不是 tool message 驱动 UI。

```text
Tool
  Agent 主动检索 memory / history / trace / artifact。

Schema state
  Runtime 保存这次 run / turn / message 被提供、检索、引用过哪些上下文。

Projection
  Main/renderer store 把 schema state 投影成 thread.agent.contextInclusions。

Renderer
  ContextEvidencePanel 只消费 projection，不解析 tool message，不查询 live memory 表反推 UI。

Tool message
  只服务模型回路。即使 tool message 被隐藏、压缩或重新排版，Evidence UI 仍必须正确。
```

这个模式与 todos / subagents 对齐：

```text
write_todos tool
  -> state.todos
  -> todos.replaced runtime event
  -> thread.agent.todos
  -> renderer 渲染 todos

search_memory tool
  -> state.contextInclusions
  -> context.inclusionsReplaced runtime event
  -> thread.agent.contextInclusions
  -> renderer 渲染 Context / Evidence
```

## 设计目标

1. `AgentMemory` 继续作为长期记忆本体，不承载运行时上下文关系。
2. `AgentContextInclusion` 表达运行时上下文 / evidence 关系，不是长期记忆。
3. `provided` 只表示“被系统提供给模型”，不表示模型实际使用。
4. `retrieved` 只表示“Agent tool 成功检索并写入 state”，不表示模型实际引用。
5. `cited` 只有在回答引用机制明确后才能写入，不能仅凭模型自称使用了什么。
6. renderer 不解析 tool message，不直接拼 raw trace，不从 live memory 表反推历史 run。
7. 主聊天 surface 只能有一个 context/evidence truth source。
8. 长期记忆写入仍必须走 `AgentMemorySuggestion` 和用户确认，不允许静默保存。
9. 运行时上下文状态必须可恢复、可审计、可测试。

## 非目标

- 不把所有聊天历史自动总结成长期记忆。
- 不默认引入向量库。
- 不把规则文件、AGENTS.md、技能来源合并进 `AgentMemory`。
- 不让 renderer 解析 tool result JSON 来判断 UI。
- 不把 memory 文本混进 message content。
- 不把“被提供给模型”误称为“被模型实际使用”。
- 不做静默自动写入 active memory。
- 第一版不要求实现 turn/message-level UI，但 schema 必须允许后续迁移。

## 当前实体语义

### `AgentMemory`

长期记忆本体。保存用户确认过的偏好、稳定事实和纠正记录。

示例：

```text
用户偏好：不要用 fallback 掩盖真实错误。
工作区事实：内部 canonical name 使用 jingle。
纠正记录：projection 失败应先查 owner，不应自动重试。
```

`AgentMemory` 不记录某次回答用了什么上下文。它只回答“系统长期记住了什么”。

### `AgentMemorySuggestion`

候选长期记忆。Agent 可以提出，但必须由用户接受后才变成 active `AgentMemory`。

V2 中，`propose_memory` 或类似工具创建 suggestion 时，可以把相关 `AgentContextInclusion.id`、`messageId`、`traceId` 写入 `reviewPayload`，让用户知道候选记忆从哪里来。接受 suggestion 后，`AgentMemory.metadata` 应保留来源 suggestion 和 evidence id。

### `OpenworkMemoryContextPack`

run start 前由 memory owner 构造的上下文包。它包含：

- 文件型上下文，例如 rules / instruction source / workspace context file。
- 结构化 active memory，例如 `about_me`、`workspace_context`、`correction`。
- diagnostics，例如某个 context source 读取失败。
- workspace identity 和 generatedAt。

`OpenworkMemoryContextPack` 是 run start 的输入事实。它必须冻结到 run metadata 的 `openworkMemoryContextSnapshot`，用于 refresh、reopen、resume 时还原同一份 provided context。恢复时不能重新读取当前 live memory 表来冒充旧 run 的上下文。

### `AgentMemoryInclusion`

V1 的结构化 memory inclusion 审计表。它记录某个 run 包含过哪些 `AgentMemory`。

V2 中它可以继续用于：

- structured memory 的审计。
- `lastIncludedAt` 统计。
- settings / debug 入口展示 memory inclusion audit。
- 兼容现有数据。

但它不能继续作为主聊天回显的事实源。主聊天 surface 的 Context / Evidence UI 必须来自 `AgentContextInclusion` 的 runtime/schema state projection。

### `AgentContextInclusion`

运行时上下文关系。它不是长期记忆，而是记录某次 run / turn / message 中，上下文如何进入 Agent 工作。

建议契约：

```ts
export type AgentContextSourceType =
  | "memory"
  | "context_file"
  | "history_message"
  | "trace_step"
  | "artifact"

export type AgentContextInclusionMode =
  | "provided"
  | "retrieved"
  | "cited"

export type AgentContextAvailability =
  | "available"
  | "unavailable"

export type AgentContextUnavailableCode =
  | "deleted"
  | "not_found"
  | "permission_denied"
  | "snapshot_missing"
  | "source_unreadable"

export interface AgentContextJumpTarget {
  type: AgentContextSourceType
  memoryId?: string
  path?: string
  threadId?: string
  messageId?: string
  runId?: string
  traceId?: string
  traceStepId?: string
  artifactId?: string
}

export interface AgentContextUnavailableReason {
  code: AgentContextUnavailableCode
  message: string
}

export interface AgentContextInclusion {
  id: string
  runId: string
  threadId: string
  turnId: string | null
  messageId: string | null
  sourceType: AgentContextSourceType
  sourceId: string
  mode: AgentContextInclusionMode
  title: string
  preview: string
  target: AgentContextJumpTarget
  availability: AgentContextAvailability
  unavailableReason?: AgentContextUnavailableReason
  metadata?: Record<string, unknown>
  createdAt: number
}
```

字段语义：

- `id`: 稳定 id。相同 run、mode、sourceType、sourceId、turn/message 绑定应生成同一个 id，避免 refresh 后 UI 抖动。
- `runId`: inclusion 所属 run。
- `threadId`: inclusion 所属 thread。
- `turnId`: 第一版可为 `null`；当它绑定到某个 user -> assistant turn 后填入。
- `messageId`: 第一版可为 `null`；当它绑定到某条 assistant answer 后填入。
- `sourceType`: 来源类别。
- `sourceId`: durable source id。memory 用 `memoryId`；history 用 `messageId`；trace 用 trace/step id；artifact 用 artifact id；context file 用稳定 path/id。
- `mode`: `provided` / `retrieved` / `cited`。
- `title`: UI summary 标题，必须来自 owner 生成的 view model。
- `preview`: 冻结过的短 preview。历史回显优先读 snapshot 中的 preview，不重新读取 live source。
- `target`: 跳转目标契约。renderer 只能根据这个契约跳转或禁用跳转，不能猜 URL 或反查 raw table。
- `availability`: 当前 evidence 是否可打开。
- `unavailableReason`: source 被删、权限不足、trace blob 缺失等情况的明确原因。
- `metadata`: owner 私有附加信息，不作为 renderer 的主要跳转契约。
- `createdAt`: inclusion 写入 schema state 的时间。由 writer 提供；从 snapshot 重建时使用冻结时间，不能每次 refresh 变动。

## 权威状态与恢复闭环

### 权威 owner

V2 的权威状态分两层：

1. Live authoritative state: LangGraph schema state 中的 `contextInclusions`。
2. Durable recovery state: checkpoint / run snapshot 中持久化的 `contextInclusions`。

`AgentThreadRunStateSnapshot.contextInclusions` 是 main 给 renderer 的读取投影，不是新的 owner。renderer store 中的 `thread.agent.contextInclusions` 也是投影，不是来源。

第一版不新增独立 DB 表作为 canonical owner。`AgentMemoryInclusion` 继续作为 V1 structured memory inclusion audit，不升级为 `AgentContextInclusion` 的主存储。如果后续为了审计新增 `AgentContextInclusion` DB 表，它也必须从 schema state 写入事件派生，且 renderer 仍通过 thread snapshot / runtime event projection 消费，不直接查表反推 UI。

### Live stream 路径

```text
AgentService run start
  -> OpenworkMemoryService.buildContextPack(...)
  -> freeze OpenworkMemoryContextSnapshot into Run.metadata
  -> seed state.contextInclusions with provided inclusions
  -> emit context.inclusionsReplaced
  -> AgentThreadRunner reducer
  -> thread.agent.contextInclusions
  -> ContextEvidencePanel
```

要求：

- `run.started` 或新 run preparation 必须清理上一轮未绑定的 run-level inclusions，避免旧 run 的 provided context 暂时显示在新 run 上。
- `context.inclusionsReplaced` 第一版可以整体替换，和 `todos.replaced` 保持一致。
- 当 tool 后续写入 `retrieved` inclusion 时，writer 可以生成完整数组并发 `context.inclusionsReplaced`；不需要第一版做增量协议。

### Snapshot / hydrate 路径

`AgentThreadRunStateSnapshot` 必须包含：

```ts
interface AgentThreadRunStateSnapshot {
  // existing fields
  contextInclusions: AgentContextInclusion[]
}
```

恢复路径：

```text
ThreadsService.getPersistedAgentThreadData(...)
  -> read checkpoint / latest run state
  -> read frozen openworkMemoryContextSnapshot for provided context if needed
  -> return runState.contextInclusions
  -> deriveThreadBootstrapState(...)
  -> ThreadRuntimeProjector.hydrateFromThreadData(...)
  -> thread.agent.contextInclusions
```

要求：

- refresh / reopen 后，`ContextEvidencePanel` 看到的 inclusion 必须和 live run 时一致。
- resume interrupted run 时，必须使用 run metadata 中冻结的 `OpenworkMemoryContextSnapshot`，不能用当前 workspace 的 live memory 重新构造旧 run 的 provided context。
- workspace mismatch 继续沿用现有 workspace identity 校验；不能静默换 workspace 并重算 context。
- hydrate 失败不能被包装成“空 context 正常”。如果 checkpoint / run metadata 损坏，主流程要暴露明确 diagnostic 或 IPC error。

### Run metadata 和 checkpoint 的关系

`OpenworkMemoryContextSnapshot` 是 provided context 的冻结输入。它用于：

- 审计 run start 时提供给模型的上下文。
- resume 时重建同一份 model context。
- 在 checkpoint 还没有写入初始 state 或需要修复投影时，重建 provided inclusions。

`contextInclusions` 是运行时关系 state。它用于：

- renderer 回显 Context / Evidence。
- tool retrieved/cited evidence 的追加。
- turn/message-level evidence 的恢复。

不要把两者合并成一个概念。context snapshot 说明“系统当时准备了什么上下文”；context inclusion 说明“这些上下文以什么关系进入了 run / turn / message”。

## 写入协议

### `provided`

写入时机：

- 新 run 开始，`OpenworkMemoryContextPack` 构造完成并冻结到 run metadata 后。

写入 owner：

- `OpenworkMemoryService` / agent service 负责把 `OpenworkMemoryContextPack.items` 转换为 `AgentContextInclusion(mode="provided")`。
- Runtime/schema state owner 负责写入 `state.contextInclusions` 并发出 `context.inclusionsReplaced`。

写入规则：

- structured memory item 生成 `sourceType: "memory"`。
- file/context source item 生成 `sourceType: "context_file"`。
- `preview` 来自冻结 context item 内容的短摘录。
- `target` 必须能表达 memory settings / context file / source path 的跳转或不可跳转状态。
- `provided` 只表示被放进 model context，不表示被模型使用。
- temporary mode 下不读取 structured `AgentMemory`，不生成 `sourceType: "memory"` 的 provided inclusion。context file 是否仍 included 取决于 `OpenworkMemoryContextPack` 的明确结果，不能靠 renderer 猜。

### `retrieved`

写入时机：

- `search_memory`
- `search_history`
- `get_message_context`
- `get_trace_evidence`

这些 tool 查询成功并得到可展示 evidence view model 后。

写入 owner：

- tool owner 查询 main-owned 数据源。
- tool owner 生成 `AgentContextInclusion(mode="retrieved")`。
- runtime/schema state owner 写入 `contextInclusions`。

写入规则：

- 查询失败不写入 fake inclusion。
- 没查到结果可以返回“无结果”的 tool result，但不应写入 `unavailable` inclusion。`unavailable` 只用于曾经存在的 evidence 后来不可读。
- tool result 给模型简短说明即可，不能成为 UI truth source。
- 对同一 run/turn/source 的重复检索应 upsert 同一 inclusion，而不是无限追加重复项。

### `cited`

写入时机：

- 只有当回答引用机制明确后，例如结构化 citation annotation、显式 cite tool、或 assistant message metadata 中有经过 runtime 校验的引用关系。

禁止：

- 不能因为模型自然语言说“我使用了某条记忆”就写 `cited`。
- 不能从最终回答文本里用正则猜 evidence。

写入 owner：

- citation 机制的 owner 校验引用目标存在，并将对应 inclusion 或 source 写成 `mode: "cited"`。

第一版可以不写 `cited`。UI 可以先支持 label，但不能展示没有可靠写入来源的 cited 数据。

## Run / Turn / Message 生命周期

### 第一版 run-level 展示

第一版允许所有 `provided` inclusion 使用：

```ts
turnId: null
messageId: null
```

`ContextEvidencePanel` 可以挂在 active run / footer 区域，以 run-level summary 展示。

新 run 开始时：

- 清理上一轮未绑定的 run-level inclusions。
- 等 runId 和 frozen context snapshot ready 后，用新 run 的 provided inclusions 替换。

resume interrupted run 时：

- 不把 interrupted run 的 inclusions 清空。
- 从 checkpoint / frozen snapshot hydrate 原 run 的 context facts。
- 后续 tool retrieved inclusions 继续写入同一个 run。

edit last user message / truncate 时：

- 被删除 message 之后的 message-bound / turn-bound evidence 必须一起移除。
- run-level latest inclusions 按新 run 替换。

### 迁移到 turn/message-level

当 assistant answer messageId 确定后，可以把当前 run-level inclusion 绑定到：

- `turnId`: user message id 或 runtime 创建的 stable turn id。
- `messageId`: assistant answer id。

迁移目标：

```text
messageProjection.turns[n]
  -> assistant message
  -> contextInclusions where messageId or turnId matches
  -> ContextEvidencePanel near that answer
```

要求：

- message-bound evidence 不应被新 run 清掉。
- `AgentThreadDataSnapshot` 必须能返回当前消息页需要的 historical inclusions，而不是只返回 latest run 的 inclusions。
- 历史消息附近的 evidence 从 checkpoint / durable state 恢复；renderer 不能根据 `latestRunId` 去查 live memory inclusion 表。

### 历史 evidence 恢复

长期目标是：打开历史 thread 时，消息附近的 evidence 能随消息一起恢复。

实现原则：

- 对 run-level 第一版，历史 evidence 可以先只显示 latest run summary。
- 一旦进入 turn/message-level，snapshot 读取层必须按当前 message page 收集对应 `contextInclusions`。
- 如果 source 后来不可读，保留 inclusion 的 `title` / `preview`，将 `availability` 标为 `unavailable`，并显示明确原因。
- 不允许因为 source 缺失就静默删除 evidence，除非对应 message/turn 被用户明确删除或 truncate。

## 渲染边界

### `ContextEvidencePanel`

`ContextEvidencePanel` 是主聊天 surface 的唯一 Context / Evidence 回显组件。

职责：

- 只消费 `thread.agent.contextInclusions`。
- 展示 mode、sourceType、title、preview、availability。
- 根据 `target` 提供跳转或禁用态。
- 不解析 tool message。
- 不调用 `memory.listIncludedMemoriesForRun`。
- 不从 live `AgentMemory` 表或 trace 表拼 UI。

### `IncludedMemoriesPanel`

`IncludedMemoriesPanel` 属于 V1 included memory audit UI。它可以保留在 settings 或 debug 入口，但不能和 `ContextEvidencePanel` 并列驱动当前聊天回显。

硬验收：

- `ChatContainer` / `LauncherAiConversation` 的主聊天 footer 或 message surface 不能同时挂 `ContextEvidencePanel` 和 `IncludedMemoriesPanel`。
- 主聊天回显不能依赖 `latestRunId -> memory.listIncludedMemoriesForRun`。
- 如果保留 `IncludedMemoriesPanel`，文案必须表达“included memory audit”，不能暗示模型使用了这些记忆。

## Owner 边界

### Runtime schema owner

文件范围：

- `src/shared/agent-thread-runtime.ts`
- `src/shared/app-types.ts`
- `src/shared/agent-thread-bootstrap.ts`
- `src/main/agent/agent-thread-runner.ts`
- `src/renderer/src/lib/thread-store-core.ts`
- `src/renderer/src/lib/agent-runtime-event-projector.ts`
- `src/renderer/src/lib/agent-runtime-snapshot-reducer.ts`

职责：

- 定义 `contextInclusions` state。
- 定义 `context.inclusionsReplaced` event。
- 让 live stream、snapshot hydrate、refresh、reopen、resume 后状态一致。
- 保证 renderer store 只是 projection。

### Memory owner

文件范围：

- `src/shared/openwork-memory.ts`
- `src/main/openwork-memory/service.ts`
- `src/main/openwork-memory/middleware.ts`
- `src/main/db/agent-memory.ts`

职责：

- 管长期 `AgentMemory` 和 `AgentMemorySuggestion`。
- 构造 `OpenworkMemoryContextPack`。
- 生成 `provided` context inclusion。
- 提供 `search_memory` 的 main-side 数据能力。
- 保留 `AgentMemoryInclusion` 审计，但不让它驱动主聊天回显。

### History / trace / artifact owner

文件范围：

- `src/main/db/message-search.ts`
- `src/main/db/threads.ts`
- `src/main/db/agent-traces.ts`
- `src/main/db/agent-events.ts`
- artifact service / presentation owner

职责：

- 提供 message、trace、artifact evidence 查询。
- 输出可投影的 evidence view model。
- 不把 raw trace 直接暴露给 renderer 作为默认 UI 数据。
- 查询失败时返回明确错误，不写假 inclusion。

### Renderer owner

文件范围：

- `src/renderer/src/lib/message-projection.ts`
- `src/renderer/src/components/chat/ContextEvidencePanel.tsx`
- `src/renderer/src/components/chat/*`
- `src/renderer/src/ai-core/LauncherAiConversation.tsx`

职责：

- 消费 `thread.agent.contextInclusions`。
- 渲染 Context / Evidence summary 和 details。
- 不解析 tool message。
- 不从 live memory 表、trace 表、artifact 表反推当前聊天 evidence。

## 失败语义

### Context pack 构造失败

- 可读取的 context item 仍可进入 context pack。
- 不可读取的 context source 写入 `OpenworkMemoryContextPack.diagnostics`。
- diagnostics 必须可观察：至少进入 run metadata / log；后续可以投影为 unavailable evidence。
- 不阻塞核心 run，除非 workspace identity、权限或配置前置条件失败。
- 不生成假 inclusion 来表示成功读取。

### Tool 查询失败

- tool 返回结构化错误。
- 不写入 `contextInclusions`。
- 不把失败包装成空结果。
- 不告诉用户“已加入 context state”。

### Evidence source 后来不可用

- 如果历史 message 被删、trace blob 不可读、artifact 缺失、memory 被 archived，已存在 inclusion 不应被 renderer 猜测修复。
- snapshot/projection owner 设置 `availability: "unavailable"` 和明确 `unavailableReason`。
- UI 显示 title/preview 和 unavailable 状态；jump target 禁用或打开错误详情。

### Persistence / hydrate 失败

- `getAgentThreadData` 不能把 hydrate 失败静默变成空 `contextInclusions`。
- 如果 checkpoint / run metadata 损坏，返回明确 IPC error 或 thread-level diagnostic。
- renderer 可以隐藏 panel，但必须有可观察错误入口，不能让用户以为该 run 没有 evidence。

### Temporary mode

- 不读取 structured `AgentMemory`。
- 不写入 `AgentMemorySuggestion`。
- 不生成 `sourceType: "memory"` 的 provided inclusion。
- 如果 temporary mode 仍读取文件型 context source，必须只生成 `sourceType: "context_file"`，并保持文案清楚。

### Suggestion 写入失败

- 作为 tool 错误返回。
- 不创建 active memory。
- 不告诉用户 pending suggestion 已保存。

## V1 到 V2 的收敛步骤

### Step 1: 语义改名

把 UI 中的 “used memories” 语义改成 “provided context” 或 “included context”。

原因：`AgentMemoryInclusion` 表达的是 run 中被注入的 structured memory，不代表模型实际引用。

验收：

- UI 不再暗示所有 included memory 都被回答使用。
- 设置项保留时，文案与真实语义一致。

### Step 2: 增加 runtime state

在 `AgentThreadRuntimeState` 和 `AgentThreadRunStateSnapshot` 增加 `contextInclusions`。

验收：

- `context.inclusionsReplaced` 能更新 `thread.agent.contextInclusions`。
- snapshot hydrate 能恢复 `thread.agent.contextInclusions`。
- renderer 不需要查 `latestRunId` 才能知道当前上下文关系。

### Step 3: 把 context pack 写入 state

run 开始构造 `OpenworkMemoryContextPack` 后，同时生成 `provided` inclusions。

验收：

- active memory 和 context file 都能在 state 中看到。
- temporary mode 不产生 memory provided inclusion。
- context snapshot 保持冻结，resume 时使用同一份上下文事实。
- refresh / reopen 后 panel 仍显示同一批 provided inclusions。

### Step 4: renderer 从 state 回显

新增或收敛 `ContextEvidencePanel`。

验收：

- 主聊天 surface 不再挂 `IncludedMemoriesPanel`。
- renderer 不调用 `memory.listIncludedMemoriesForRun` 驱动当前聊天回显。
- renderer 不解析 tool message。
- context panel 可以折叠展开。

### Step 5: 新增主动查询 tools

先做：

```text
search_memory
get_message_context
```

再接：

```text
search_history
get_trace_evidence
```

验收：

- tool 调用成功后结果进入 `contextInclusions(mode="retrieved")`。
- tool message 可以隐藏或压缩，UI 仍能正确回显。
- 查询失败显式返回错误，不写 fake inclusion。

### Step 6: suggestion 绑定 evidence

`propose_memory` 创建 `AgentMemorySuggestion` 时，把相关 evidence id 写入 `reviewPayload`。

验收：

- 用户能看到候选记忆从哪里来。
- 接受候选记忆后，`AgentMemory.metadata` 保留来源 suggestion 和 evidence。
- 长期记忆仍必须由用户确认。

## 第一版推荐切面

第一版只做以下闭环：

```text
OpenworkMemoryContextPack
  -> AgentContextInclusion(mode="provided")
  -> state.contextInclusions
  -> context.inclusionsReplaced
  -> AgentThreadRunStateSnapshot.contextInclusions
  -> thread.agent.contextInclusions
  -> ContextEvidencePanel
```

必须同时覆盖 live 和 recovery：

- live run 能显示。
- refresh 能恢复。
- reopen 能恢复。
- resume 使用 frozen snapshot。
- 主聊天不再显示旧 `IncludedMemoriesPanel`。

第二版再加：

```text
search_memory / get_message_context
  -> AgentContextInclusion(mode="retrieved")
  -> ContextEvidencePanel
```

第三版再接：

```text
search_history / get_trace_evidence
  -> message / trace / artifact evidence
  -> turn-level / message-level ContextEvidencePanel
```

## 验收标准

1. `AgentMemory`、`AgentMemorySuggestion`、memory settings 继续工作。
2. `AgentContextInclusion` 不写入 active memory，不替代 `AgentMemory`。
3. `provided` 只表示被提供给模型，不暗示模型实际使用。
4. `contextInclusions` 的 authoritative owner 是 runtime/schema state；renderer store 只是 projection。
5. `AgentThreadRunStateSnapshot.contextInclusions` 支持 snapshot hydrate、refresh、reopen。
6. resume 使用 frozen `OpenworkMemoryContextSnapshot`，不重算旧 run 的 memory context。
7. `ContextEvidencePanel` 是主聊天 surface 唯一 Context / Evidence 回显入口。
8. 主聊天 surface 不调用 `memory.listIncludedMemoriesForRun` 驱动当前聊天 evidence。
9. tool message 被隐藏或压缩后，Evidence UI 仍正确。
10. temporary mode 不读取 structured memory、不写 suggestion、不生成 memory provided inclusion。
11. tool 查询失败不写 fake inclusion。
12. persistence / hydrate 失败有可观察错误，不静默表现为“没有 context”。

## 测试矩阵

### Runtime reducer event 测试

覆盖：

- `createDefaultAgentThreadRuntimeState` 初始 `contextInclusions: []`。
- `context.inclusionsReplaced` 更新 state。
- 旧 revision event 不覆盖新 state。
- new run start 清理上一轮未绑定 run-level inclusions。
- message truncate 删除被截断 turn/message 的 evidence。

### Snapshot / hydrate 恢复测试

覆盖：

- `AgentThreadDataSnapshot.runState.contextInclusions` hydrate 到 `thread.agent.contextInclusions`。
- `deriveThreadBootstrapState` 保留 context inclusions。
- `ThreadRuntimeProjector.hydrateFromThreadData` 不把 context 清空。
- `readThreadDataOverlay` 把 live runtime `contextInclusions` 写回 overlay snapshot。
- refresh/reopen 后 `ContextEvidencePanel` 仍有同一批 inclusions。

### Run start provided inclusion 测试

覆盖：

- `OpenworkMemoryContextPack.items` 转成 `mode: "provided"`。
- structured item 生成 `sourceType: "memory"`。
- file item 生成 `sourceType: "context_file"`。
- generated id 稳定，refresh 不抖动。
- `preview` 来自 frozen snapshot。
- temporary mode 不生成 memory provided inclusion。
- context pack diagnostics 不生成假 success inclusion。

### Tool retrieved inclusion 测试

覆盖：

- `search_memory` 成功后写 `mode: "retrieved"`。
- `get_message_context` 成功后写 `sourceType: "history_message"`。
- 查询失败返回结构化错误且不写 state。
- 空结果不写 unavailable inclusion。
- 重复检索同一 source upsert，不重复刷屏。

### Renderer 边界测试

覆盖：

- `ContextEvidencePanel` 只从 `thread.agent.contextInclusions` 取数据。
- 主聊天 `ChatContainer` / `LauncherAiConversation` 不挂 `IncludedMemoriesPanel`。
- 主聊天回显不调用 `memory.listIncludedMemoriesForRun`。
- tool message 隐藏或压缩后，Evidence UI 仍显示 state 中的 evidence。
- unavailable evidence 显示明确状态，不猜 fallback 文案。

### Long-term memory safety 测试

覆盖：

- `propose_memory` 只创建 `AgentMemorySuggestion`。
- 用户接受前不会写 active `AgentMemory`。
- suggestion `reviewPayload` 能包含 evidence id。
- 接受 suggestion 后 `AgentMemory.metadata` 保留来源信息。
