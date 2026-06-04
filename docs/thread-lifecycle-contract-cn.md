# Openwork Thread Lifecycle Contract（草案）

这份文档定义 Openwork 在 `run / cancel / checkpoint / delete` 这组动作上的统一生命周期边界。

目标不是再修一个竞态，而是让后续同类问题有稳定 owner、稳定顺序、稳定失败语义。

配套阅读：

- [docs/runtime-invariants.md](/Users/junjieding/dingjunjie_dev/2026_03/openwork/docs/runtime-invariants.md)
- [docs/engineering-boundaries.md](/Users/junjieding/dingjunjie_dev/2026_03/openwork/docs/engineering-boundaries.md)

## 1. 这次为什么会反复补洞

当前实现里，这三个 owner 都是合理的，但没有被一个统一 contract 串起来：

- `run` 生命周期 owner 在 [src/main/agent/service.ts](/Users/junjieding/dingjunjie_dev/2026_03/openwork/src/main/agent/service.ts)
- `checkpoint` 写入 owner 在 [src/main/checkpointer/prisma-saver.ts](/Users/junjieding/dingjunjie_dev/2026_03/openwork/src/main/checkpointer/prisma-saver.ts)
- `thread` durable 删除 owner 在 [src/main/db/threads.ts](/Users/junjieding/dingjunjie_dev/2026_03/openwork/src/main/db/threads.ts)

问题不在“缺少模块”，而在“跨模块动作没有强制顺序”：

- delete 之前没有强制 stop active run
- stop run 之后没有强制 drain checkpointer queue
- checkpointer 不只写 checkpoint，还顺带做 FTS / HITL 副作用
- DB delete 是事务 owner，但应用层没有先封住新的 invoke / resume 入口

于是边界场景会表现为：

1. 运行还没完全停，thread 已进入删除路径
2. thread 删了，晚到的 checkpoint write 才报外键错误
3. cancel / resume / delete 分别在不同模块里改状态，彼此只靠“约定”配合

## 2. 设计目标

这次收口要满足下面 5 个目标：

1. 同一个 `threadId` 的关键生命周期动作必须串行。
2. DB row 删除只能有一个 durable owner。
3. checkpointer 只负责“写”和“drain”，不负责删除策略。
4. delete 是 lifecycle operation，不是普通 CRUD。
5. 方案优先适配当前 `single main process + SQLite + Prisma` 拓扑，不为未来分布式提前做重基础设施。

## 3. 非目标

这次不做下面这些事：

- 不引入 Kafka / BullMQ / Temporal / NATS 之类新基础设施
- 不把 runtime 拆成 sidecar 或远端 service
- 不替换 LangGraph checkpoint 体系
- 不一次性重写 renderer runtime 协议

如果未来真的进入多进程、多 worker、远端 runtime，再把同一个 contract 迁到 durable lease / queue 即可。

## 4. 核心不变量

### 4.1 Thread 级串行

对同一个 `threadId`，下面这些动作不能并发交错：

- `invoke`
- `resume`
- `cancel`
- `delete`

它们必须经过同一个 thread lifecycle gate。

### 4.2 删除独占

一旦 thread 进入 deleting：

- 新的 `invoke / resume` 必须立即失败，返回明确 conflict
- `cancel` 可以视为 no-op 或 join 当前删除流程
- 删除流程必须先完成 runtime quiesce，再进入 DB 删除

### 4.3 DB 删除唯一 owner

`Checkpoint / CheckpointWrite / Run / Thread / HitlRequest / SessionBinding` 的 durable 删除，唯一 owner 仍然是：

- [dbDeleteThread](/Users/junjieding/dingjunjie_dev/2026_03/openwork/src/main/db/threads.ts:498)

runtime、checkpointer、service 层都不允许绕过这层删除 row。

### 4.4 Checkpointer 不拥有删除策略

[PrismaCheckpointSaver](/Users/junjieding/dingjunjie_dev/2026_03/openwork/src/main/checkpointer/prisma-saver.ts) 只允许做两件事：

- serialize checkpoint writes
- close / drain 当前 saver instance

它不应再维护 `deletedThreads` 之类 lifecycle policy，也不应决定 thread 是否还允许写。

### 4.5 副作用不是生命周期 owner

FTS 同步、HITL request 提取、标题抽取这些都属于 derived side effects。

它们可以：

- best-effort
- 延后
- 重放

但它们不能反过来决定 thread lifecycle，也不能承担 delete gate。

## 5. 正确的 owner 划分

### AgentService

职责：

- 处理 `invoke / resume / cancel`
- 驱动 runtime
- 调用 run persistence

不负责：

- durable delete
- checkpoint row 删除
- 自己发明 deleting policy

### ThreadLifecycleGate

这是本次需要新增的薄边界。

职责：

- 为每个 `threadId` 维护一个轻量的 ephemeral lifecycle record
- 串行化 `invoke / resume / cancel / delete`
- 在 delete 前完成 runtime quiesce
- 在 delete 期间拒绝新的 `invoke / resume`

不负责：

- 删除 DB row
- 删除 checkpoint row
- FTS / HITL / artifact side effects

它应该是 gate，不应该长成新的业务 orchestrator。

### PrismaCheckpointSaver

职责：

- checkpoint upsert
- checkpoint write upsert
- queue drain

不负责：

- thread deleting state
- run cancelling state
- checkpoint row 删除策略

### ThreadsService / dbDeleteThread

职责：

- delete durable thread-owned rows
- artifact cleanup

其中 DB row 删除的真实 owner 仍然是 `dbDeleteThread`。

## 6. 建议的 lifecycle 状态模型

Phase 1 先用 main-process 内存态表达，不急着落 durable deleting。

每个 thread 的 ephemeral lifecycle state：

- `idle`
- `starting`
- `running`
- `cancelling`
- `deleting`

说明：

- `starting`：run 已被接纳，但可能还没有 `runId`
- `running`：runtime stream 已建立，或至少 `runId` 已落库
- `cancelling`：abort 已发出，正在等 runtime 收敛
- `deleting`：已进入独占删除窗口，拒绝新 run

durable 状态仍沿用当前体系：

- `run.status`: `running / success / error / interrupted`
- `thread.status`: `busy / idle / error / interrupted`

Phase 1 不强行新增 durable `deleting`，因为当前是单 main process，本地 gate 足够兜住顺序。

## 7. 每个动作的正确顺序

### 7.1 invoke / resume

1. 通过 lifecycle gate claim thread
2. 如果 thread 正在 deleting，立即返回 conflict
3. 如果当前已有 active run，按现有产品语义先 abort 旧 run，再等待它 finish
4. 进入 `starting`
5. 完成 workspace / context / precondition setup
6. `beginAgentRun` 或 `resumeAgentRun`
7. 进入 `running`
8. runtime finish 后统一收敛 durable status，并释放 gate

Phase 1 保持当前“新 invoke 会打断旧 run”的产品语义，不引入新的 conflict 行为。

### 7.2 cancel

1. 通过 lifecycle gate 找到 active run
2. 发出 abort signal
3. thread 进入 `cancelling`
4. runtime finish path 统一做最终 durable status 收敛
5. 释放 gate

兼容策略：

- 如果必须保留“cancel 之后尽快看到 interrupted durable status”，可以在 Phase 1 保留现有 `markRunAborted` 前置语义
- 但长期目标应该是显式 `cancelling` 事实，而不是用提前写 durable `interrupted` 来模拟

### 7.3 delete

正确顺序必须是：

1. 进入 `deleting`
2. 拒绝新的 `invoke / resume`
3. abort active run，并等待 runtime finish
4. `closeCheckpointer(threadId)`，drain 当前 saver queue 并移除缓存实例
5. 调用 `dbDeleteThread(threadId)` 删除 durable rows
6. best-effort 删除 artifacts
7. 释放 lifecycle gate

关键点：

- `closeCheckpointer` 必须在 `dbDeleteThread` 之前
- runtime / saver 不允许自己删 checkpoint rows

## 8. 失败语义

### invoke / resume during deleting

- 明确返回 conflict
- 不创建新 run row
- 不创建新 checkpoint row

### delete during running

- delete 必须等待 active run 收敛
- 不允许 DB delete 和 runtime write 并发交错

### checkpoint side effect failure

- 允许 best-effort
- 不应重新打开已进入 deleting 的 thread
- 不应让 saver 进入永久“假删除”状态

### delete transaction failure

- thread 应保持“未删除”
- 由于 delete 发生在 `closeCheckpointer` 之后，系统不会留下“thread 还在但 saver 继续乱写”的窗口
- 删除失败后，后续是否允许重新 invoke，取决于 deleting gate 是否已释放；Phase 1 应释放，允许后续显式重试

### process crash during deleting

Phase 1 依赖 SQLite 事务原子性：

- 要么 DB delete 已完成
- 要么 DB delete 未开始或未提交

由于 gate 是内存态，重启后不会残留“僵尸 deleting”。

## 9. 为什么现在不需要 Kafka / BullMQ / Temporal

当前拓扑是：

- 单 main process
- 单本地 SQLite
- checkpoint writer 已经是单实例内串行 queue

因此最合适的是：

- 一个 keyed in-memory lifecycle gate
- 一个 DB transaction owner
- 一个 checkpointer drain boundary

Kafka / BullMQ / Temporal 更适合：

- 多 worker
- 远端 runtime
- 跨进程 durable orchestration
- 大量后台任务调度

当前 Openwork 这类 thread lifecycle 问题，还没到必须引入这些基础设施的阶段。

## 10. 分批落地方案

### Phase 1：立住 lifecycle contract

目标：

- 引入 `ThreadLifecycleGate`
- delete 顺序改成 `quiesce -> closeCheckpointer -> dbDeleteThread`
- `AgentService.invoke/resume/cancel` 统一经过 gate

这一批不动 checkpoint side effect 结构。

### Phase 2：拆出 checkpoint derived side effects

目标：

- 把 FTS 同步、HITL 提取从 `PrismaCheckpointSaver.put` 里拆出来
- saver 退回“纯 checkpoint persistence”
- derived projector / syncer 变成显式后置动作

这一批能显著降低“修 checkpoint 顺带牵出别的语义”的阅读负担。

### Phase 3：再决定要不要 durable gate

只有在下面条件出现时再做：

- main process 不再是唯一 runtime owner
- 需要 sidecar / remote runtime
- thread lifecycle 跨多个 worker 协调

那时再考虑：

- durable lease table
- thread lifecycle table
- Redis / queue / workflow engine

## 11. 建议的提交切片

1. 纯设计文档
2. lifecycle gate + delete 顺序调整 + targeted tests
3. checkpoint side effects 拆分 + targeted tests
4. 如果未来需要，再单独做 durable gate 或 sidecar-ready contract

## 12. 最重要的一句话

这次要解决的，不是“再多挡一个竞态”。

真正要解决的是：

**同一个 thread 的 `run / cancel / checkpoint / delete`，以后必须只沿着一条主路收敛。**
