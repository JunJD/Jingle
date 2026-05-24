# History Shell Store Roadmap

这个 roadmap 约束 History 页 renderer 状态从 `zustand` 迁移到仓库内 external store 的节奏。

## Goal

- 删除 `zustand` 这个唯一的 renderer 状态库依赖
- 保持 `window.api.*` 作为唯一副作用边界
- 在 React 边界使用 `useSyncExternalStore`，而不是再引入新的状态框架
- 让 History 页状态可以脱离 React 和 Electron window 单独测试

## Boundary

### Store Core

拥有：

- `threads`、`currentThreadId`、`showKanbanView` 等 History 页共享状态
- 线程列表、线程创建、线程删除、模型供应商列表这类 UI 级编排动作
- 对外暴露 `getState` / `subscribe`

不拥有：

- React 组件树
- `window` 全局读取
- thread runtime stream / artifact stream 真正的长期数据源

### React Hook Shell

拥有：

- 通过 `useSyncExternalStore` 订阅 store snapshot
- 对现有消费方保持 `useHistoryShellStore()` API 形状稳定

不拥有：

- 业务编排
- 状态写入逻辑

### Side-Effect Boundary

拥有：

- `window.api.threads.*`
- `window.api.models.*`

不拥有：

- 本地 UI 状态缓存
- React 订阅逻辑

## Test Snapshot

当前仓库测试基础已经具备，但要区分层次：

- BDD 已经覆盖 main / IPC / 跨窗口用户流程
- node test 已经覆盖纯逻辑和 parser
- 缺的是 renderer 状态容器本身的单元测试入口

这次迁移的门禁应是：

1. 每次改动前先建立或补齐对应的最小 BDD 用户流场景。
2. 改动前先跑该 BDD，确认当前基线。
3. 改动后再次跑同一个 BDD，确认行为未回归。
4. node 单测验证 store core 行为。
5. `typecheck` 验证 renderer / preload / tests 三侧类型。

推荐命令：

```bash
npm run test:bdd:target -- tests/bdd/features/<feature>.feature --name "<场景名>"
npm run test:node:target -- tests/node/history-shell-store.test.ts
npm run typecheck
```

## Execution Plan

### Phase 0 - Freeze Boundary And Test Gate

Deliverables:

- `docs/history-shell-store-roadmap.md`
- `docs/history-shell-store-cleanups.md`
- `package.json` 中的 `test:node` / `test:node:target` 命令

Exit criteria:

- 这轮改动只作用在 History 页 renderer 状态边界
- 后续每次 pause 都先走“BDD 建立/运行 -> 改动 -> BDD 回归”的固定门禁
- 同时保留固定的 node 测试入口

### Phase 1 - Extract A Pure Store Core

Deliverables:

- `src/renderer/src/lib/history-shell-store-core.ts`
- 可注入 API 依赖的 `createHistoryShellStore(...)`

Exit criteria:

- store 行为可以在 node 环境直接构造和验证
- store core 不依赖 React，也不直接读 `window`

### Phase 2 - Swap The React Boundary To useSyncExternalStore

Deliverables:

- `src/renderer/src/lib/history-shell-store.ts` 改为 hook 外壳
- 现有组件调用点尽量不改
- 删除 `zustand` 依赖

Exit criteria:

- History 页仍通过同一个 hook 消费状态
- 仓库不再有 `zustand` 运行时依赖

### Phase 3 - Tighten Imperative Reads Only If They Stay Hot

Deliverables:

- 评估 `useHistoryShellStore.getState()` 的保留点
- 只对持续制造耦合的点继续拆分，不做提前抽象

Exit criteria:

- 仅保留少量明确的命令式编排入口
- 不引入新的全局状态框架或 context 套娃
