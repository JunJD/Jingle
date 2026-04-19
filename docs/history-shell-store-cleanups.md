# History Shell Store Cleanups

这份 cleanups 只记录这轮迁移后仍然值得继续收口、但不应该在同一个 pause 里顺手扩大的点。

## Active

### 1. 评估命令式 `getState()` 读取是否还需要继续收口

当前保留点：

- `src/renderer/src/lib/history-thread-ops.ts`

原因：

- 这里本质上是编排代码，需要同步拿一次 snapshot 再决定后续异步动作
- 当前先保留，避免为了“纯函数化”把调用链拆散

删除条件：

- 某个调用点开始同时承担订阅和命令编排，导致边界变混
- 或者相同的命令式读取模式在多个 feature 里复制扩散

### 2. 决定 `threads` 和 `model provider` 是否还要共享一个 store

当前状态：

- 先继续放在一个 store 中，因为两个域都只被 History 页消费

删除条件：

- provider 状态开始被独立页面或独立宿主反复复用
- 或者 thread/kanban 改动频率明显与 provider 改动脱耦

### 3. 给 History 页补用户流级别 BDD 的时机还没到

当前状态：

- main / IPC 层 BDD 已有
- renderer 状态迁移目前只补 node 单测，不强行补 UI BDD

删除条件：

- 真的改了 sidebar / kanban / thread hydration 的用户可见行为
- 或者出现了只能通过窗口级场景复现的回归

## Closed In This Phase

- 删除 `zustand` 依赖，不再保留兼容层
- `src/renderer/src/ai-core/history.tsx` 不再直接读取 store snapshot
- History 页主要消费点已切到 selector 订阅，不再默认订阅整个 store
