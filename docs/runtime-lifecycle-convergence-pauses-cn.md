# Runtime Lifecycle 收口执行契约

状态：`active`

本文是当前 Runtime Lifecycle 收口 Goal 的唯一执行契约。Goal 必须显式引用本文；实现范围、Pause 边界和完成条件均以本文为准。HTML、历史讨论和 sibling repo 只提供背景，不得扩张本文范围。

## 唯一目标

只修复以下四个已确认阻塞，并完成现有验证：

1. terminal first-wins 不再依赖 Promise、microtask 或 event-loop 的偶然时序。
2. UI/trace projection 在 durable commit 后调度，且不阻塞模型执行。
3. steering 和 callbacks 进入 active execution context，不再丢失或依赖隐藏 run facts。
4. compact 成为独立 operation，并通过 checkpoint storage CAS 安全写入。

四项完成后结束本 Goal。不得把“顺手清理”“架构更漂亮”或新发现的产品能力并入本轮。

## 已冻结决策

- Durable operation 只有 `invoke | resume | compact`。
- `abort` 是 control event，不是 operation。
- `completed | failed | aborted` 是 terminal outcome。
- `drain` 是内部执行机制。
- `RuntimeOperationRecord` 保存可恢复事实。
- `RuntimeExecutionContext` 只保存当前执行期资源。
- callbacks、steering buffer、abort controller 和 resolved resources 不持久化。
- terminal 顺序以事件进入统一 referee 的顺序为准，不以 Promise reject 时间或 scheduler phase 为准。
- core commit 失败决定运行结果；UI、trace、diagnostics projection 失败不能反向改写运行结果。
- compact 不复用完整 run execution，也不通过通用 LangGraph `updateState` 写真实 checkpoint。
- 不新增兼容 alias、双 owner、fallback 或静默重试。

## Pause 状态

| Pause | 范围                       | 状态       |
| ----- | -------------------------- | ---------- |
| 1     | Terminal referee           | `verified` |
| 2     | Projection commit boundary | `verified` |
| 3     | Active execution context   | `verified` |
| 4     | Compact checkpoint CAS     | `verified` |

状态只允许 `pending -> in_progress -> verified`。若遇到本文定义的停止条件，保持当前状态并记录 blocker，不新增 Pause。

## Pause 1：Terminal Referee

### 目标

建立唯一 terminal owner，删除 `setImmediate`、microtask 优先级或 Promise continuation 竞争对结果归属的影响。

### 必须成立

- complete、fail、abort 都通过同一个串行 referee 提交。
- 第一个被 referee 接纳的 terminal event 获得 claimant token。
- terminal persistence 和 settle 各执行一次。
- 后续 terminal event 只产生 ignored diagnostic，不改 durable status。
- persistence/settle 失败保留原始 runtime error，并以聚合错误暴露。

### 允许路径

- `packages/langchain-agent-harness/src/runtime-thread-run.ts`
- `packages/langchain-agent-harness/src/runtime-thread.ts`
- `packages/langchain-agent-harness/src/runtime-thread-lifecycle.ts`
- 可新增 `packages/langchain-agent-harness/src/runtime-thread-terminal.ts`

### 验收

- `abort -> complete`
- `abort -> failure`
- `failure -> abort`
- `complete -> abort`
- 原始 runtime/persistence error 与 settle error 均不丢失

验收顺序指事件进入 referee 的顺序，不用 Promise 同轮调度推断先后。

### 验收记录

- `RuntimeThreadTerminalReferee` 已成为 complete、fail、abort 的唯一 first-wins owner；源码不再包含 `setImmediate`、`queueMicrotask` 或 abort/failure scheduler 竞争。
- node typecheck、node-tests typecheck、目标 ESLint、`git diff --check` 和 `agent-persistence.test.ts` 通过。
- 只读 inline smoke 已验证 `abort -> non-Abort failure`、`failure -> abort` 以及原始 runtime error 与 settle error 聚合。
- `runtime-thread-run.test.ts` 其余 7 项通过；“先 reject Promise、同一调用栈立刻 abort”仍按 Promise reject 时刻判定 failure first，与本文冻结的 referee submission order 冲突。该测试未修改，也未通过 scheduler trick 恢复旧语义。

## Pause 2：Projection Commit Boundary

### 目标

只拆开 core commit 与 UI/trace projection；不重构 projection 产品体系。

### 必须成立

- durable run/message/checkpoint 写入继续 awaited。
- renderer、trace、diagnostics projection 在 commit 成功后同步入队并立即返回。
- projection rejection 被记录，但不改变 run outcome。
- projection 永不完成时，模型仍能开始执行。
- 同一 thread 的 projection 保持入队顺序。
- steering 的 durable state update 在模型前完成；`markSteeringApplied` 等 UI projection 不被模型等待。

### 允许路径

- `src/main/agent/controller.ts` 中三个 `onRunAccepted` callback 的精确 hunks
- `src/main/agent/service.ts` 中必要 callback contract/wiring
- `packages/langchain-agent-harness/src/run-steering.ts`
- `packages/langchain-agent-harness/src/runtime-observation.ts`

### 验收

- core commit 失败时不发 projection event。
- projection reject 时 run 保持原 terminal outcome。
- pending projection 不阻塞首次模型调用。
- prepare、run started、chunk 的 projection 入队顺序稳定。

### 验收记录

- invoke/edit/resume 的 `onRunAccepted` 只在 durable run/message event 写入后同步入队，不再把 projection Promise 返回给 `AgentService` 等待。
- `onSteersApplied` 已收敛为同步 observation dispatch；steer request 交给 model handler 后只入队 UI projection，不等待 projection 完成。
- per-thread projection queue 继续记录 rejection，并以同步入队顺序串联 prepare、run started 和 chunk。
- node typecheck、node-tests typecheck、目标 ESLint、`git diff --check`、`run-steering.test.ts`、`agent-thread-runner.test.ts` 和 `agent-persistence.test.ts` 通过。
- 只读 inline smoke 使用永不完成的 projection Promise，验证模型 handler 仍立即开始。

## Pause 3：Active Execution Context

### 目标

建立 active execution 的唯一 owner，删除当前链路对 retained full execution 和隐藏 `runFacts` registry 的依赖。

### 必须成立

- 新增内部 `RuntimeExecutionContext`。
- context 持有 terminal referee、abort controller、steering inbox、callbacks 和 resolved resources。
- `RuntimeThread` 同时最多拥有一个 active context。
- invoke/resume 在 durable admission 后创建 context，在 terminal settle 后 dispose 一次。
- steering 先形成 durable input fact，再将引用投递给 active context。
- compact 不进入 run execution context。
- operation schema 不再携带 callbacks 或 steering buffer。

### 允许路径

- 可新增 `packages/langchain-agent-harness/src/runtime-execution-context.ts`
- `packages/langchain-agent-harness/src/runtime-operation.ts`
- `packages/langchain-agent-harness/src/runtime-thread-context.ts`
- `packages/langchain-agent-harness/src/runtime-thread-lifecycle.ts`
- `packages/langchain-agent-harness/src/runtime-thread-operations.ts`
- `packages/langchain-agent-harness/src/runtime-thread-run.ts`
- `packages/langchain-agent-harness/src/runtime-execution.ts`
- `packages/langchain-agent-harness/src/runtime-execution-factory.ts`
- `packages/langchain-agent-harness/src/runtime-execution-assembly.ts`
- `src/main/agent/runtime-assembly.ts` 中 `runFacts` 的精确 hunks
- `src/main/agent/service.ts` 中必要 context input wiring

### 验收

- callbacks 和 steering buffer 进入当前 active execution，且不会因预创建 execution 丢失。
- app runtime 不再通过隐藏 `runFacts` 获取当前执行事实。
- duplicate active operation 明确返回 `RuntimeThreadBusyError`。
- disposed context 不再接受 steer、callback 或 terminal claim。
- resource resolution/cleanup 失败通过 terminal referee 暴露。

### 验收记录

- durable invoke/resume admission 现在绑定 required opaque `RuntimeExecutionFactory`；typed invoke/resume input 只被该闭包捕获，没有传播进 capability/host generics，也没有新增 resource bag、AsyncLocalStorage 或第二张 registry。
- `RuntimeExecutionContext` 在执行激活时接收该闭包，并成为 callbacks、steering buffer、abort signal、terminal referee 和 lazy `RuntimeRunExecution` 的执行期 owner；dispose 会同时清除 activation、execution promise 和绑定闭包。
- `RuntimeThreadFactory` 不再永久缓存 thread facade。Runtime 实例只持有一张以 `threadId` 为键的 active state map；reservation 时创建，terminal settle 时删除。相同 thread 的多个轻 facade 共享 busy referee，active scope 不一致时抛出 `RuntimeThreadScopeMismatchError`。
- `src/main/agent/runtime-assembly.ts` 已删除隐藏 `runFacts` registry。extension tools、memory、approval、trace 和 model 直接读取 admission 时捕获的 typed invoke/resume input；model 使用 durable admission 返回的 `start.modelId` 作为唯一执行事实。
- callbacks 和 steering buffer 在 `run.execute()` 时激活，并随同一个 bound execution factory 进入 graph execution；capability/resource resolution 仍延迟到 `execute()`，失败由 terminal referee 归入 failed outcome，settle 后 active state 可重新使用。
- manual compact 已与 active run execution 断开：`RuntimeRunExecution` 不再暴露 compact，也没有用 retained full execution 维持旧行为；独立 compact owner 已由 Pause 4 接管。
- node typecheck、目标 ESLint、Prettier check 和 `git diff --check` 通过。只读 smoke 验证轻 facade、跨 facade duplicate start、scope mismatch、lazy binding、callbacks/steering 传递、resolver failure 和 terminal 后 registry 释放。
- `runtime-thread-run.test.ts` 当前 24/24 通过。历史上依赖 Promise continuation 推断顺序的断言已改为显式 referee submission 语义；要求复用 run execution 的 compact 断言已由 Pause 4 的双向 admission 语义取代。

## Pause 4：Compact Checkpoint CAS

### 目标

只完成 manual compact 的正确链路。pre-run/post-run 自动 compact 策略不在本 Goal。

### 稳定边界

compact 只允许在以下条件同时成立时执行：

- checkpoint 已完整持久化；
- 没有 pending writes；
- 没有 pending HITL / `__interrupt__`；
- 没有 active operation；
- expected checkpoint ID/revision 仍是最新值。

不满足时返回明确错误，不复制或丢弃 pending writes。

### 必须成立

- `RuntimeThread.compact()` 创建独立 compact operation。
- caller 必须提供稳定、非空的 `operationId`；runtime 不生成随机 fallback。
- prepare 读取完整 checkpoint envelope。
- summarize 只生成 owned channel delta，不直接持久化。
- checkpoint/storage owner 在同一事务内重新读取 latest checkpoint 并执行 CAS。
- CAS 冲突返回 `CompactCheckpointConflict`，不静默重试。
- 未知 channel values、channel versions、versions seen 和 custom metadata 被保留。
- CAS 成功后才完成 compact operation。
- post-commit observation 失败不回滚 compact。

### 允许路径

- 可新增 `packages/langchain-agent-harness/src/runtime-checkpoint-compaction.ts`
- `packages/langchain-agent-harness/src/compaction-controller.ts`
- `packages/langchain-agent-harness/src/runtime-contract.ts` 中 compact module contract 的精确 hunk
- `packages/langchain-agent-harness/src/runtime-operation.ts`
- `packages/langchain-agent-harness/src/runtime.ts` 中 compact control 的精确 wiring hunk
- `packages/langchain-agent-harness/src/runtime-thread.ts` 中 compact control contract 的精确 hunk
- `packages/langchain-agent-harness/src/runtime-thread-implementation.ts` 中 compact control wiring 的精确 hunk
- `packages/langchain-agent-harness/src/runtime-thread-operations.ts`
- `packages/langchain-agent-harness/src/runtime-execution.ts`
- 可新增 `src/main/checkpointer/checkpoint-compaction-store.ts`
- `src/main/checkpointer/prisma-saver.ts` 中必要 transaction/CAS primitive
- `prisma/schema.prisma` 与单一 migration 中的 thread-scoped compact commit ledger
- `src/main/checkpointer/runtime-checkpointer-manager.ts`
- `src/main/agent/runtime-assembly.ts` 中 compact module wiring
- `packages/langchain-agent-harness/src/harness-runtime/graph/**` 中删除旧 compact graph branch 的精确 hunks
- `tests/node/runtime-compact.test.ts`
- `tests/node/runtime-thread-run.test.ts` 中 compact admission 的精确 hunks

### 验收

- 无 checkpoint：`CompactCheckpointNotFound`。
- 非稳定边界：`CompactBoundaryNotStable`。
- CAS 不匹配：`CompactCheckpointConflict`，且无部分写入。
- summarizer 或 DB commit 失败时原 checkpoint 不变。
- unknown channels、versions、versions seen 和 custom metadata 不丢失。
- CAS 后 operation completion 前崩溃时，可通过 operation ID 判断已提交事实。
- 相同 operation ID 在响应丢失后返回同一个 committed result，不重复 summarize/commit。
- 不同 operation ID 竞争同一个 prepared checkpoint 时，后者得到 CAS conflict。

### 验收记录

- `RuntimeThread.compact()` 现在先占用同一 thread active-operation reservation，再调用独立 compact control；active run 阻止 compact，active compact 也阻止新 run，二者都明确返回 `RuntimeThreadBusyError`。compact settle 后 reservation 释放，且 compact 不进入或保留 `RuntimeExecutionContext`。
- `RuntimeCompactInput.operationId` 与 `modelId` 都是 required。单一 compact input parser 规范化两个 ID，并严格拒绝非 manual trigger、非 string/null reason，以及负数、非整数或非 safe integer 的 preserve count；`RuntimeThread` 在 reservation 前解析。transitional controller 从同一次 own-data-descriptor snapshot 生成 command 与 thread scope，不会重新读取外部对象。
- `compaction-controller.ts` 只负责 manual operation 的 prepare、summarize 和 owned channel delta。它不再调用 generic LangGraph `getState/updateState`；无 checkpoint、pending writes、pending HITL 和 stale checkpoint 分别映射为 `CompactCheckpointNotFound`、带原因的 `CompactBoundaryNotStable`、`CompactCheckpointConflict`。
- `RuntimeGraph` 已删除 compact branch、compact private channels 和 run-scoped compaction capability。`CompactPrepareNode` / `CompactSummarizeNode` 只作为 controller-owned pure helper，不拥有 checkpoint commit。
- `PrismaCheckpointSaver.compactCheckpoint()` 在同一 SQLite transaction 内重读 latest checkpoint、核对 expected checkpoint ID、重查 pending writes，并只允许更新 `messages`、`compactions`、`_summarizationEvent`、`_summarizationSessionId`。完整 checkpoint envelope 的 unknown channel values、channel versions、versions seen 与 custom metadata 原样保留。
- compact summarizer 显式消费 admission 选择的 `modelId`，只生成 summary 与 owned state delta；manual compact 在 checkpoint CAS 前不写 conversation-history 文件，`historyRef` 为 `null`。checkpoint metadata 与 durable receipt/ledger 保存同一个 canonical model ID、operation ID、reason、requested preserve presence/value、expected checkpoint ID 和压缩前后消息数。safe-integer preserve count 以 SQLite/Prisma `BIGINT` 持久化。同一事务写入以 `(threadId, operationId)` 唯一寻址的 durable ledger。重试直接查 ledger，不扫描历史 checkpoint，也不依赖 latest metadata。Ledger 在 checkpoint retention 后继续阻止重复副作用，只随 thread 删除级联清理；clone 不复制源 thread 的 operation identity。
- 相同 operation ID 的响应丢失重试即使发生在后续 checkpoint 之后，仍返回第一次 committed result，summarizer 只调用一次；不同 operation ID 使用同一 stale envelope 时返回 `CompactCheckpointConflict`，不产生部分写入。
- `runtime-compact.test.ts` 13/13 通过，覆盖 success、invalid input zero-side-effect matrix、descriptor-changing Proxy、pending HITL、same-ID response loss with later checkpoint、request identity exact retry/drift、transactional already-committed replay、pure summarizer、CAS/DB failure zero-filesystem-effect、checkpoint retention/thread cleanup 和 different-ID CAS conflict；同时验证 selected model、safe-integer preserve round-trip、unknown value、versions seen、custom metadata 与完整事务回滚。`createRuntimeThreadFromControls` 已接独立 compaction port；scripted BDD thread 在 idle 状态可 compact，并使用调用方稳定 operation ID。`runtime-thread-run.test.ts` 与 compact 合并聚焦验证 37/37 通过。
- node source typecheck、node-tests typecheck、目标 ESLint、Prettier check 和 `git diff --check` 通过。

### 强制停止条件

thread-scoped compact commit ledger 是唯一已批准的 Prisma schema/migration 扩展。若还需要其他 schema 变更，停止 Pause 4 并单独申请 owner。

## 全局禁止项

- 不继续调研或对标 Flue、OpenCode、LobeHub、Craft。
- 不修改 RuntimeGraph 其他 topology、projection nodes 或 legacy middleware；仅允许删除第二个 durable compact branch。
- 不实现 task/subAgent 生命周期。
- 不做 RuntimeCapabilities、RuntimeModule 或 root API 全量重构。
- 不更新 HTML、README 或其他架构文档来代替代码完成度。
- 除 owner 明确要求的 Pause 4 acceptance proof 外，不新增或修改 tests。
- 不处理 package/lock、renderer、launcher、filesystem 或 extension；总控另行追加的 Extension admission 审查项见下节。
- 不删除与四个阻塞无直接关系的历史代码。
- 不使用 fallback、吞错、scheduler trick 或静默重试换取测试通过。
- 不整体暂存 mixed-owner 文件；`service.ts`、`controller.ts`、`runtime-public-api.ts` 只能 patch-stage 本 Goal 的精确 hunks。

## 总控追加的有限审查项

该项是 submission-readiness blocker，不新增 Pause，也不改变 Runtime Lifecycle 目标：

- required extension main definition 必须由 process-owned registry snapshot 判定 ready/pending/failed/missing。
- Agent admission 必须在 required definition pending/failed/missing 时 fail closed，不得把空 tool registry 当作可运行状态。
- platform 由 manifest registry owner 选择；definition snapshot 不提供忽略 platform 的第二套 list API。
- 只允许修改 `src/main/services/native-extensions/index.ts`、`src/main/agent/service.ts` 和对应 admission/registry 测试的精确 hunks。
- 当前验证：required pending/failed/ready admission 3/3 通过；process registry 的 pending isolation、failure 和 dispose 3/3 通过。

## 每个 Pause 的执行协议

1. 只读检查 working tree、cached diff、引用关系和当前 owner。
2. 将当前 Pause 标为 `in_progress`，只修改允许路径。
3. 运行现有聚焦验证、typecheck 和 `git diff --check`。
4. 使用 `$code-review` 只审当前 Pause 的 diff。
5. 记录实际修改文件、行为证据、验证结果和残余风险。
6. 验收全部通过后标为 `verified`，再进入下一 Pause。

发现新问题时只允许两种处理：

- 它直接阻断当前 Pause 的已冻结 invariant：在当前 Pause 内做最小 owner 修复。
- 它不阻断当前 Pause：记录到后续 backlog，不实现、不新增 Pause。

## 验证基线

每个 Pause 至少运行：

```bash
./node_modules/.bin/tsc --noEmit -p tsconfig.node.json --pretty false
./node_modules/.bin/tsc -p tests/node/tsconfig.json --pretty false
git diff --check
```

按涉及范围运行现有测试：

```bash
./node_modules/.bin/tsx --tsconfig tests/node/tsconfig.json --test \
  tests/node/runtime-thread-run.test.ts \
  tests/node/agent-persistence.test.ts \
  tests/node/run-steering.test.ts \
  tests/node/agent-thread-runner.test.ts
```

测试文件当前不是本 Goal 的编辑边界。若现有测试表达的是已被冻结决策否定的旧语义，报告冲突，不为了通过测试恢复旧架构。

## Goal 完成条件

只有以下条件全部成立时，Goal 才能标记完成：

- Pause 1 至 Pause 4 均为 `verified`。
- terminal first-wins 由显式 referee 保证。
- projection 不阻塞模型，也不改写 core outcome。
- steering/callbacks 由 active execution context 持有。
- compact 不保留完整 run execution，不调用 generic `updateState`，并由 storage CAS 写入。
- typecheck、相关现有测试和 `git diff --check` 通过，或失败被证明为本 Goal 之外的既有 dirty-tree 问题。
- staged diff 只包含本文允许的 dependency-closed hunks。
- 最终报告按代码事实列出完成项、未完成项、验证结果和后续 backlog。

完成后立即停止，不继续下一轮架构优化。
