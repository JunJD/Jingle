# Agent Context State Memory V2 设计与分步验收

## 0. 文档目的

这份文档定义 Openwork 的长期记忆、session 历史检索、ThreadDigest 摘要投影、runtime evidence state 和 renderer 回显边界。它必须能独立指导实现、review 和验收，不依赖任何外部对话上下文。

V2 的目标不是“把更多文本塞进模型”，而是建立一条可恢复、可审计、可回显的上下文链路：

```text
长期记忆 / thread 摘要 / 历史消息 / trace / artifact
  -> run start context pack 或 runtime retrieval tools
  -> LangGraph schema state: contextInclusions
  -> stream values / checkpoint snapshot / hydrate
  -> renderer thread store projection
  -> ContextEvidencePanel / MemoryReviewPanel
```

每一步都必须有明确 owner。renderer 只能消费 runtime/schema state 的投影，不能解析 tool message、live memory inclusion 表、trace 表或 artifact 表来反推主聊天 evidence UI。

## 1. 核心结论

1. `Thread` 就是 Openwork 内部 session 本体。
2. `SessionBinding` 只是 thread/session 与外部来源的绑定关系，不是 session 本体，也不是 summary owner。
3. `AgentMemory` 是长期记忆本体，只能通过 `AgentMemorySuggestion` + 用户确认写入。
4. `OpenworkMemoryContextPack` 只负责 run start 时冻结 provided context。
5. `AgentMemoryInclusion` 是 V1 structured memory inclusion audit，不能驱动主聊天 evidence 回显。
6. `ThreadDigest` 是可重建的 thread/session 摘要投影，用于 session 级 history routing。
7. `messages_fts` / `messages_fts_trigram` 是具体历史消息证据层。
8. `AgentContextInclusion` 是 runtime evidence 关系 state，不是长期记忆。
9. 主聊天 UI 的唯一 context/evidence truth source 是 `thread.agent.contextInclusions`。
10. `provided` 只表示被提供给模型，不等于模型实际使用。
11. `retrieved` 只表示工具检索结果被提供给模型，不等于模型最终引用。
12. `cited` 只能由明确 citation 机制写入，不能凭模型自称使用了什么。
13. temporary mode 下不读取 structured memory、不写 suggestion、不生成 memory provided inclusion。

## 2. 领域实体与 owner

### 2.1 Thread

`Thread` 是 session 本体，拥有 messages、runs、trace、artifacts、runtime snapshot 和 ThreadDigest。

history retrieval 必须在没有 `SessionBinding` 的情况下仍然工作。`SessionBinding` 可以增强显示或外部路由，但不能成为 history retrieval 的前置条件。

### 2.2 SessionBinding

`SessionBinding` 表达外部会话或本地 binding key 到当前 `Thread` 的关系：

```prisma
model SessionBinding {
  sessionKey      String  @id @map("session_key")
  workspaceKey    String  @map("workspace_key")
  workspacePath   String  @map("workspace_path")
  currentThreadId String  @map("current_thread_id")
  metadata        String?
}
```

V2 规则：

- `currentThreadId` 指向当前 thread/session。
- `sessionKey` 是外部或本地 binding key。
- IM 信息如果存在，只能存在于 binding metadata 或后续显式字段中。
- summary 不写入 `SessionBinding.metadata`。
- `search_history` 不依赖 `SessionBinding`。

### 2.3 AgentMemory

`AgentMemory` 是长期记忆本体，适合保存用户确认过的稳定偏好、工作区长期事实和纠正记录。

不适合保存：

- 所有历史对话摘要。
- 某次 run 检索了什么上下文。
- 某个 session 当前做到哪一步。

### 2.4 AgentMemorySuggestion

`AgentMemorySuggestion` 是候选长期记忆。模型只能创建 pending suggestion，不能直接写 active memory。

V2 中 suggestion 可以带来源：

```ts
interface OpenworkMemoryEvidenceRef {
  id: string
  mode: AgentContextInclusionMode
  preview: string
  sourceId: string
  sourceType: AgentContextSourceType
  target: AgentContextJumpTarget
  threadId: string
  title: string
}
```

写入规则：

- `suggest_personal_memory` 从当前 runtime state 的 `contextInclusions` 生成 `reviewPayload.evidenceIds` 和 `reviewPayload.evidenceRefs`。
- 只允许绑定 `availability: "available"` 且非 `provided` 的 evidence refs。
- 用户接受前不能写 active `AgentMemory`。
- 用户接受后，`AgentMemory.metadata` 保留 `acceptedSuggestionId`、`sourceRunId`、`threadId`、`evidenceIds` 和 `evidenceRefs`。

### 2.5 OpenworkMemoryContextPack

`OpenworkMemoryContextPack` 是 run start 时冻结的 provided context pack。它可以包含 structured memory、文件型 context、diagnostics、workspace identity 和 generatedAt。

职责：

- run start 时冻结“系统主动提供给模型的上下文”。
- 生成 `mode: "provided"` 的 `AgentContextInclusion`。
- 保存到 run metadata / checkpoint 恢复路径。

非职责：

- 不做 history retrieval。
- 不代表模型实际使用了这些内容。
- temporary mode 下不读取 structured `AgentMemory`。

### 2.6 AgentMemoryInclusion

`AgentMemoryInclusion` 是 V1 audit 表，用于记录某个 run included 过哪些 structured `AgentMemory`。

允许用途：

- memory audit。
- `lastIncludedAt` 统计。
- settings/debug 入口。

禁止用途：

- 驱动主聊天 evidence UI。
- 通过 latest run 查询来回显当前聊天上下文。

### 2.7 ThreadDigest

`ThreadDigest` 是 thread/session 的派生摘要投影，不是长期记忆。

当前持久模型：

```prisma
model ThreadDigest {
  threadId             String @id @map("thread_id")
  status               String @default("pending")
  summary              String?
  topics               String?
  decisions            String?
  openQuestions        String? @map("open_questions")
  messageCount         Int    @default(0) @map("message_count")
  projectedThroughSeq  Int    @default(0) @map("projected_through_seq")
  sourceHash           String? @map("source_hash")
  projectionError      String? @map("projection_error")
  generatedAt          BigInt? @map("generated_at")
  createdAt            BigInt @map("created_at")
  updatedAt            BigInt @map("updated_at")
}
```

当前 shared record：

```ts
interface ThreadDigestRecord {
  decisions: string[]
  generatedAt: number | null
  messageCount: number
  openQuestions: string[]
  projectedThroughSeq: number
  projectionError: string | null
  sourceHash: string | null
  status: "pending" | "ready" | "failed"
  summary: string | null
  threadId: string
  topics: string[]
  updatedAt: number
}
```

FTS：

- `thread_digests_fts` 使用 `unicode61`。
- `thread_digests_fts_trigram` 使用 `trigram`。
- 搜索文本由 `summary + topics + decisions + openQuestions` 以及分词结果组成。

语义：

- `ThreadDigest` 是 session 级 routing 层。
- `ThreadDigest` 可异步生成、可重建。
- projection failure 不阻塞 checkpoint / run persistence。
- failure 必须写 `status: "failed"` 和 `projectionError`，不能写 fake digest。

### 2.8 Message FTS

message search projection 是具体证据层。它回答：

```text
哪条历史消息提供了可检索、可展示、可展开的证据？
```

它不负责总结整个 session，也不替代 `ThreadDigest`。

### 2.9 AgentContextInclusion

`AgentContextInclusion` 是 runtime evidence 关系 state。

当前契约：

```ts
type AgentContextSourceType =
  | "memory"
  | "context_file"
  | "thread_digest"
  | "history_message"
  | "trace_step"
  | "artifact"

type AgentContextInclusionMode = "provided" | "retrieved" | "cited"
type AgentContextAvailability = "available" | "unavailable"

interface AgentContextInclusion {
  availability: AgentContextAvailability
  createdAt: number
  id: string
  messageId: string | null
  metadata?: Record<string, unknown>
  mode: AgentContextInclusionMode
  preview: string
  runId: string
  sourceId: string
  sourceType: AgentContextSourceType
  target: AgentContextJumpTarget
  threadId: string
  title: string
  turnId: string | null
  unavailableReason?: {
    code: "deleted" | "not_found" | "permission_denied" | "snapshot_missing" | "source_unreadable"
    message: string
  }
}
```

`target` 是 UI jump contract。source 不可用时，UI 不能猜 target；应使用 frozen `title/preview` 并展示 unavailable reason。

## 3. 权威状态与恢复闭环

### 3.1 Live owner

`contextInclusions` 的 live owner 是 LangGraph schema state。

```text
run start / retrieval tool
  -> Command.update({ contextInclusions })
  -> values stream
  -> AgentThreadRunner handlePayload
  -> context.inclusionsReplaced event
  -> AgentThreadRuntimeState.contextInclusions
  -> renderer store projection
```

renderer store 只是投影，不是来源。

### 3.2 Durable owner

`AgentThreadRunStateSnapshot.contextInclusions` 是 durable recovery contract。

```text
checkpoint channel_values.contextInclusions
  -> AgentThreadRunStateSnapshot.contextInclusions
  -> deriveThreadBootstrapState
  -> AgentRuntimeManager hydrate
  -> ContextEvidencePanel
```

要求：

- stream 期间一致。
- refresh 后一致。
- reopen 后一致。
- resume interrupted run 后一致。
- tool message 被隐藏、压缩或不再展示 raw result 后，evidence UI 仍然正确。

### 3.3 Run start 生命周期

新 run 开始时：

- 清理上一轮未绑定的 run-level inclusions。
- 保留已绑定到 `turnId` 或 `messageId` 的 historical retrieved/cited inclusions。
- 使用 frozen `OpenworkMemoryContextPack` 生成新 run 的 provided inclusions。

resume interrupted run 时：

- 不重新读取 live memory 冒充旧 run context。
- 使用 frozen context snapshot / checkpoint 中的 inclusions。
- 保留同一 run 的 runtime evidence state。

### 3.4 Turn / message-level 生命周期

第一版允许 global/run-level 展示：

```ts
turnId: null
messageId: null
```

当 active run 有 stable `turnId` / message id 时，retrieved evidence 会绑定到当前 turn：

```ts
turnId: activeRun.turnId
messageId: activeRun.assistantMessageId if present, otherwise activeRun.userMessageId
```

规则：

- `provided` 保持 run-level，不绑定成“使用证据”。
- non-provided evidence 在同一 run 中多次 tool retrieval 要累积，不互相覆盖。
- 新 run 不清掉 historical message-bound evidence。
- truncate/edit 删除相关消息后，inclusion 标记 `availability: "unavailable"` 和 `unavailableReason.code: "deleted"`。

## 4. 写入协议

### 4.1 provided

owner：run start context pack builder / runtime invoke path。

写入时机：

- run start 时从 frozen `OpenworkMemoryContextPack` 生成。
- resume 时从 frozen snapshot/checkpoint 恢复，不重新读取 live memory。

语义：

- `provided` 只表示这些 context 被提供给模型。
- `provided` 不等于模型使用。
- temporary mode 下，不读取 structured memory，也不生成 `sourceType: "memory"` 的 provided inclusion。

### 4.2 retrieved

owner：runtime context retrieval middleware。

写入时机：

- `search_history` 成功向模型返回 digest/message 内容后写入。
- `get_message_context` 成功返回 message window 后写入。
- `get_trace_evidence` 成功返回 trace/artifact 内容后写入。
- V2 不实现 `search_memory` retrieval 写入。active structured memory 只通过 run start context pack 以 `provided` 进入模型上下文。

失败规则：

- 空结果不写 inclusion。
- source 不存在不写 inclusion。
- blob/artifact 缺失不写 fake inclusion。
- tool error 不应被包装成“已检索”。

### 4.3 cited

owner：未来明确 citation mechanism。

当前 V2 不凭模型自称写 `cited`。只有当回答引用机制能把 final answer span 与具体 source id 绑定时，才允许写 `mode: "cited"`。

## 5. ProjectionQueue 与 ThreadDigest

### 5.1 ProjectionQueue

V2 使用本地 main process `ProjectionQueue`，不引入外部 MQ。

能力：

- `enqueue(job)`：按 key 合并 scheduled/dirty jobs。
- `markDirty(job)`：标记 stale job，不立刻调度。
- `flush()`：清 timer，串行 drain 所有 dirty/scheduled jobs。
- `onError(job, error)`：记录 projection failure。
- `stateKey`：允许同一进程热重载时共享 queue state。

要求：

- projection failure 不影响核心 checkpoint/run persistence。
- `closeRuntime` / `closeDatabase` 必须 flush projection queues。
- crash 后不依赖 durable job table；通过 projection 可重建和 stale detection 恢复。

### 5.2 ThreadDigest projection

触发：

- run terminal event recorder enqueue。
- closeRuntime / closeDatabase flush。

生成：

- 使用 `modelPreference: "fast"`。
- `thinkingEffort: "off"`。
- run name: `thread_digest`。
- timeout: 8s。
- bounded prompt：最多 80 条 user/assistant projected messages，最多 16000 chars。
- 输出 strict JSON：`summary`, `topics`, `decisions`, `openQuestions`。
- zod 校验和 normalize 后才写 `thread_digests`。

失败：

- `markThreadDigestProjectionPending(threadId)` 表示开始 projection。
- 失败写 `status: "failed"` 和 `projectionError`。
- 失败清空 digest FTS，不写 fake search row。
- 已有 digest 被失败覆盖为 failed 是可观察 diagnostic，不伪装为 ready。

## 6. Retrieval tools

### 6.1 search_history

目的：

```text
根据 query 找相关 thread/session，再返回具体 history message evidence。
```

输入：

```ts
{
  query: string
  limit?: number
  threadId?: string
}
```

执行：

1. 查询 `thread_digests_fts` 和 `thread_digests_fts_trigram`。
2. 如果传入 `threadId`，digest 和 messages 都 scoped 到该 thread。
3. 无 `threadId` 时，先用 digest 命中的 thread ids 路由 message FTS。
4. digest 缺失时，message FTS 继续作为具体历史消息证据层。
5. tool result 必须把 digest summary 和 matched message bodies 返回给模型。
6. 成功返回给模型的 digest 写 `sourceType: "thread_digest"` inclusion。
7. 成功返回给模型的 messages 写 `sourceType: "history_message"` inclusion。

空结果：

- 返回 no result message。
- 不写 inclusion。

### 6.2 get_message_context

目的：

```text
围绕某条 projected history message 展开 bounded transcript window。
```

输入：

```ts
{
  threadId: string
  messageId: string
  before?: number
  after?: number
}
```

执行：

1. 从 projected messages 读取目标 thread。
2. 定位 focus message。
3. 返回 before/after window。
4. 写 focus `history_message` inclusion。

失败：

- message 不存在：返回 not found，不写 inclusion。
- thread 不存在或无 projected messages：返回 not found，不写 inclusion。
- 不从当前 thread 猜目标 message 所属 thread。

### 6.3 get_trace_evidence

目的：

```text
按 run / trace step / tool call / artifact 展开执行证据。
```

输入至少包含一个 selector：

```ts
{
  runId?: string
  traceId?: string
  traceStepId?: string
  toolCallId?: string
  artifactId?: string
  includeInput?: boolean
  includeOutput?: boolean
}
```

执行：

- trace owner 查询 trace / step / blob。
- artifact owner 查询 artifact。
- 返回 bounded input/output/artifact evidence。
- 成功返回 trace step 时写 `trace_step` inclusion。
- 成功返回 artifact 内容时写 `artifact` inclusion。

失败：

- trace 不存在不写 inclusion。
- step 不存在不写 inclusion。
- requested blob 缺失不写 inclusion。
- artifact 缺失不写 artifact inclusion。

### 6.4 search_memory

主 Agent 默认不暴露 `search_memory`。

原因：

- active structured memory 已经通过 run start context pack provided。
- history retrieval 的目标是 thread/session 历史，应走 `search_history`。
- 长期记忆和历史消息必须保持概念分离。

V2 不保留该 tool。settings/debug 可以展示 `AgentMemory` 与 `AgentMemoryInclusion` audit，但不能通过 `search_memory` 参与主 Agent retrieval。

## 7. Renderer 边界

### 7.1 ContextEvidencePanel

`ContextEvidencePanel` 是主聊天 context/evidence 回显入口。

职责：

- 只消费 `thread.agent.contextInclusions`。
- 支持 global/run-level、turn-level、message-level placement。
- 展示 mode、source label、title、preview、availability。
- 不解析 tool message。
- 不查询 live memory inclusion 表、trace 表或 artifact 表来驱动主聊天 evidence。

### 7.2 IncludedMemoriesPanel

`IncludedMemoriesPanel` 只能保留在 settings/debug/audit 入口。

硬约束：

- 主聊天 surface 不能挂 `IncludedMemoriesPanel`。
- 主聊天不能调用 `memory.listIncludedMemoriesForRun` 驱动回显。
- tool result 隐藏/压缩后 evidence UI 仍由 `ContextEvidencePanel` 显示。

### 7.3 MemoryReviewPanel

`MemoryReviewPanel` 展示 pending `AgentMemorySuggestion`。

允许读取：

- `memory.listSuggestions({ status: "pending", threadId })`。
- suggestion 的 `reviewPayload.evidenceRefs`。

不允许：

- 从 tool message 反推 suggestion 来源。
- 从 live included memory 表反推 suggestion 来源。
- 用户接受前写 active memory。

## 8. Failure semantics

### 8.1 Context pack

- 可读取 item 进入 context pack。
- 不可读取 source 写 diagnostics。
- diagnostics 进入 snapshot/log。
- 不生成 fake success inclusion。
- workspace identity / permission 前置失败可以阻塞 run，并明确报错。

### 8.2 ThreadDigest

- projection failure 不阻塞 checkpoint。
- failure 写 `ThreadDigest.status = "failed"` 和 `projectionError`。
- FTS 不保留 failed digest 的 fake search row。
- search_history 可以继续返回 message hits，但不能伪造 thread summary。

### 8.3 Tools

- 查询失败不写 inclusion。
- 空结果不写 inclusion。
- source 缺失不写 fake inclusion。
- tool result 给模型的内容必须和写入 inclusion 的 source 一致。

### 8.4 Unavailable evidence

如果历史消息、trace blob、artifact、memory 后来不可读：

- 保留 frozen `title` / `preview`。
- 标记 `availability: "unavailable"`。
- 写明确 `unavailableReason`。
- UI 禁用跳转或展示不可用状态。

### 8.5 Temporary mode

- 不读取 structured `AgentMemory`。
- 不写 `AgentMemorySuggestion`。
- 不生成 memory provided inclusion。
- 文件型 context 仍可读取，并只生成 `context_file` provided inclusion。

## 9. 分阶段实施与 Pause Gate

每个 phase 完成后暂停 review。每批代码提交前必须跑 code-review。文档更新放在最后收口，但文档最终必须和真实实现一致。

### Phase 0: 文档冻结

目标：

- 固化本文档中的 owner、状态、tool 协议、失败语义和验收矩阵。

验收：

- 文档自洽，不依赖外部对话。
- 明确 `Thread = Session`。
- 明确 `SessionBinding` 只是外部绑定。
- 明确 `ThreadDigest + messages FTS` 是 history retrieval 核心。
- 明确 `contextInclusions` 是主聊天 evidence truth source。

Pause Gate：

- 文档 review 通过。

### Phase 1: 通用 ProjectionQueue

目标：

- main process 有复用型 projection queue。
- 支持 coalesce key、debounce、串行 drain、flush、onError。
- trace/digest 等派生投影不阻塞核心持久化。

验收：

- queue coalesce/debounce/flush/error 测试通过。
- closeRuntime / closeDatabase flush projection。
- projection failure 可观察。

### Phase 2: Runtime evidence state baseline

目标：

- `contextInclusions` 完成 live event、snapshot、hydrate、refresh、reopen、resume 闭环。
- `ContextEvidencePanel` 成为主聊天 evidence truth source。

验收：

- live run provided context 可显示。
- refresh/reopen/resume 一致。
- renderer 不调用 `memory.listIncludedMemoriesForRun` 驱动主聊天回显。
- tool message 隐藏/压缩后 evidence UI 仍正确。

### Phase 3: Tool surface 收敛

目标：

- 主 Agent 默认不暴露 `search_memory`。
- `search_history` / `get_message_context` / `get_trace_evidence` 有 action renderer shell 和 tool labels。

验收：

- 缺 renderer 不再导致聊天崩溃。
- retrieval shell 不展示 raw result，不作为 evidence truth source。

### Phase 4: ThreadDigest schema/projection

目标：

- 新增 ThreadDigest 持久模型、FTS、shared type、repository 和 projection generator。
- run terminal 后 enqueue digest projection。

验收：

- digest 可生成、更新、搜索、失败诊断。
- 同 thread 多次 enqueue 合并。
- closeRuntime/closeDatabase flush。
- generator 使用 fast model、thinking off、strict JSON、bounded prompt。
- failure 不写 fake digest。

### Phase 5: search_history 升级

目标：

- `search_history` 先搜 ThreadDigest，再搜 messages FTS。
- 结果按 thread/session 分组并写 inclusions。

验收：

- 无 threadId 时 session routing 生效。
- 有 threadId 时 scoped search。
- digest 缺失时只返回 message hits 并不写 fake digest inclusion。
- 空结果不写 inclusion。

### Phase 6: get_message_context

目标：

- `get_message_context` 使用 `threadId + messageId + before + after` 展开 projected transcript window。

验收：

- 支持跨 thread 展开。
- missing message 不写 inclusion。
- tool result 给模型包含 bounded transcript。
- UI 仍从 state projection 回显。

### Phase 7: get_trace_evidence

目标：

- 按 runId/traceStepId/toolCallId/artifactId 查询 trace/artifact evidence。

验收：

- trace step retrieval。
- toolCallId lookup。
- missing blob no fake inclusion。
- linked artifact inclusion。

### Phase 8: turn/message-level evidence

目标：

- evidence 从 run-level 迁移到 turn/message-level，历史消息附近可恢复显示。

验收：

- 新 run 不清掉 message-bound evidence。
- 历史 thread hydrate 后 evidence 在对应消息附近。
- truncate/edit 清理或标记 unavailable。

### Phase 9: memory suggestion evidence binding

目标：

- suggestion reviewPayload 绑定 evidence refs。
- accept 后 AgentMemory.metadata 保留来源。
- temporary mode 不写 suggestion。

验收：

- suggestion 来源可见。
- 用户接受前不写 active memory。
- 接受后 metadata 保留 source。
- temporary mode 不暴露 suggestion tool。

## 10. 最小测试矩阵

### ProjectionQueue

- coalesce by key。
- debounce drain。
- flush drains pending jobs。
- onError called and queue continues。

### Runtime state

- default state includes `contextInclusions: []`。
- `context.inclusionsReplaced` updates state。
- snapshot/hydrate restores inclusions。
- new run clears unbound run-level inclusions。
- resume preserves interrupted run inclusions。
- same-run retrieval inclusions accumulate。
- truncate/edit marks related evidence unavailable。

### Provided context

- context pack items become provided inclusions。
- structured memory creates memory provided inclusion。
- context file creates context_file provided inclusion。
- temporary mode creates no memory provided inclusion。

### ThreadDigest

- projection creates ready digest。
- projection updates through latest message seq。
- FTS searches summary/topics/decisions/openQuestions。
- projection failure is diagnostic and not searchable。
- empty thread stays non-ready/no fake digest。

### search_history

- routes through ThreadDigest first。
- returns concrete message bodies to model。
- writes thread_digest/history_message inclusions only for successful results。
- scoped thread search works。
- missing digest path does not write fake digest inclusion。
- empty result writes no inclusion。

### get_message_context

- expands around focus message。
- supports cross-thread focus messages。
- missing message writes no inclusion。
- result content reaches model。

### get_trace_evidence

- retrieves trace step by traceStepId。
- retrieves trace step by toolCallId。
- missing trace/blob writes no fake inclusion。
- linked artifact writes artifact inclusion only when content is provided。

### Renderer

- main chat does not mount `IncludedMemoriesPanel`。
- main chat does not call `memory.listIncludedMemoriesForRun`。
- `ContextEvidencePanel` reads `thread.agent.contextInclusions`。
- tool renderer shell exists for retrieval tools。
- tool result hidden/compressed still leaves evidence visible。
- `MemoryReviewPanel` displays suggestion evidence refs from reviewPayload。

### Long-term memory

- suggestion creation does not write active memory。
- accept suggestion writes active memory with source metadata。
- reviewPayload parser rejects non-schema evidence refs。
- temporary mode writes no suggestion。

## 11. 完成定义

V2 完成必须同时满足：

1. 当前代码实现了 Phase 1-9 的 owner、state、tool、projection、renderer 和 memory safety 边界。
2. 本文档与当前实现一致，不保留早期冲突草案。
3. targeted tests 覆盖所有核心验收项。
4. `npm run typecheck` 通过。
5. guardrails 通过。
6. code-review 无阻塞 finding。
7. 未把主聊天 evidence UI 回退到 tool message、live memory inclusion 表或 renderer-only state。
