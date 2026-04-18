# Tsyringe Migration Roadmap

这个 roadmap 用来约束 Openwork main process 的长期重构节奏。

目标不是一次性把 `ipcMain.handle(...)` 全改成新风格，而是在不丢产品初心的前提下，把 main process 逐步收口为清晰的 `controller -> service -> repository/gateway` 边界，并用稳定的 BDD 门禁保证每次 pause 都可验证。

## Decision

本次长期任务的装配方案选型为 `tsyringe`。

选择它的原因：

- 需要一个轻量容器来管理逐步增长的 main-side service 图
- 现阶段不需要 `InversifyJS` 那种更重的框架化生态
- 迁移重点是边界收口，不是引入新的 controller framework

`tsyringe` 在这个项目中的职责仅限于对象装配和作用域管理，不负责定义 IPC 协议、业务流程或 Electron 安全边界。

## Goal

把当前 main process 逐步演进成下面的结构：

- `controller`
  - 负责 IPC / 事件入口
  - 负责参数接收、错误映射、窗口上下文读取
- `service`
  - 负责业务流程编排
  - 不直接依赖 Electron `event`
- `repository/gateway`
  - 负责 DB、文件系统、checkpointer、native extension、外部模型接口等边界
- `composition root`
  - 负责 `tsyringe` 注册和对象装配
  - 只在 main bootstrap 处出现

## Boundary

### Composition Root

拥有：

- `tsyringe` container 初始化
- service / repository / gateway 注册
- controller 实例装配

不拥有：

- 业务流程
- IPC channel 具体行为

### Controller

拥有：

- `ipcMain.handle` / `ipcMain.on` 绑定
- 输入输出映射
- 读取 `event.sender`、当前窗口等 Electron 上下文
- 把异常转换成 renderer 能理解的失败语义

不拥有：

- 持久化细节
- 跨模块业务编排细节

### Service

拥有：

- 线程、workspace、settings、launcher、agent runtime 等业务流程
- 多个 repository/gateway 之间的编排

不拥有：

- Electron 原始事件
- `contextBridge`
- React 状态

### Repository / Gateway

拥有：

- DB 读写
- 文件系统访问
- runtime/checkpointer 接口
- 外部 provider / native extension 接口

不拥有：

- IPC channel 语义
- UI 路由决策

### Preload / Renderer

拥有：

- 调用稳定 IPC 契约
- 不感知 `tsyringe` 或容器存在

不拥有：

- main process 依赖装配

## Non-Goals

- 不把 `tsyringe` 变成业务框架
- 不在 renderer 中引入容器
- 不为了“以后可能会用到”预先抽象出通用模块系统
- 不在迁移初期同时改写所有 domain

## Current BDD Snapshot

已覆盖的用户可见或核心边界：

- agent 长流程、取消、HITL 暂停与恢复
- app launch / launcher / main / settings 基本窗口流
- artifact tab 工作流
- artifacts 基础主进程契约
- model provider 远程列表状态
- recording fs
- threads 基础主进程契约
- launcher-history 基础主进程契约
- local-start 基础主进程契约
- shortcuts 基础主进程契约
- tool approval
- subagent read-only guardrail
- todo-list extension
- workspace 基础主进程契约

当前 Phase 1 BDD 缺口：

- 已补齐。后续迁移中只按新暴露的行为边界增量补测。

这意味着下一步可以开始引入 composition root，但每次 pause 仍然必须先选定单个 domain 和可执行验收场景。

## Pause Protocol

每次 pause 只推进一个小闭环，顺序固定：

1. 选定一个 domain 和一个最小用户行为边界。
2. 如果该边界没有 BDD 场景，先补 feature/steps。
3. 只做通过该场景所需的最小结构迁移。
4. 运行单个目标 BDD。
5. 通过后才进入下一个 pause。
6. 如果遇到“当前不会、但这次推进必须理解”的知识点，直接沉淀到相关设计文档或代码注释里。
7. 如果引入兼容层、双写、过渡 shim，必须在同一个变更中写清删除条件。

推荐命令：

```bash
npm run test:bdd:target -- tests/bdd/features/<feature>.feature
```

跑单个场景时：

```bash
npm run test:bdd:target -- tests/bdd/features/<feature>.feature --name "<场景名>"
```

## Execution Plan

### Phase 0 - Freeze Boundaries And Harness

Deliverables:

- `docs/tsyringe-migration-roadmap.md`
- `package.json` 中的单目标 BDD 命令入口

Exit criteria:

- `tsyringe` 只用于装配的边界被写清
- 每次 pause 的 BDD 门禁命令固定
- 知识型阻塞有统一沉淀位置
- 兼容代码有统一记账位置

### Phase 1 - Fill The BDD Gaps Before Refactor

先补 domain 级行为测试，再允许迁移。

`agent` 当前已经有第一批 BDD，覆盖：

- invoke stream / done / idle
- 长时间运行时 cancel
- HITL pause 写入 pendingApproval
- resume approve 后清空 pendingApproval
- interrupt reject 后清空 pendingApproval

`threads` 当前已经有第一批 BDD，覆盖：

- create
- clone
- delete
- history
- runtime state

后续只有在迁移中暴露出新的线程行为边界时，再补增量场景。

`workspace` 当前已经有第一批 BDD，覆盖：

- 全局 workspace set/get
- 线程 workspace 覆盖
- 全局 workspace 重启后持久化
- 线程 workspace override 重启后持久化
- 文本文件读取
- 越界路径拒绝
- 二进制文件读取
- Main 窗口线程切换时 workspace picker 跟随当前线程

`launcher-history` 当前已经有第一批 BDD，覆盖：

- list 排序
- pin
- remove
- 从 `launcher:executeAction` 执行 local start 打开动作后记录 history

`local-start` 当前已经有第一批 BDD，覆盖：

- upsert
- 同路径更新去重
- recordUse 排序和计数
- remove

`shortcuts` 当前已经有第一批 BDD，覆盖：

- preload bootstrap 与 main 当前设置一致
- setSettings / getSettings
- resolved binding default / override
- settingsChanged 事件
- global availability
- 重启后的 override 持久化语义

`native-extensions` 当前已经有第一批 BDD，覆盖：

- 读取 first-party extension settings schema
- 保存并读取 extension preferences
- 保存并读取 command preferences
- preferencesChanged 事件跨 Launcher / Settings 窗口广播
- invoke 通过主进程 native extension service 返回错误

`native-menu-bar` 当前已经有第一批 BDD，覆盖：

- setState 后可读取当前命令状态
- itemSelected 事件可回到 Launcher renderer
- clearState 后状态会被清理

`external-links` 当前已经有第一批 BDD，覆盖：

- 公共 `https://` 链接会被转发给 Electron shell
- `localhost` 链接会被拒绝且不会触发 Electron shell

`model-provider` 当前已经有第一批 BDD，覆盖：

- 远程模型列表失败后错误状态不会被刷新冲掉
- 全局模型列表使用供应商真实返回的模型
- Renderer 通过 `models:*` IPC 读取供应商状态

`settings` 当前已经有第一批 BDD，覆盖：

- Renderer 通过 `settings:*` IPC 保存 agent config locale，重启后仍然保留
- Renderer 通过 `settings:*` IPC 保存 launcher windowMode，重启后仍然保留

`artifacts` 当前已经有第一批 BDD，覆盖：

- 按 threadId list artifacts
- readFile 读取托管文本 artifact
- readBinaryFile 返回托管文件 base64
- open download action 返回托管文件 uri

Exit criteria:

- 每个待迁移 domain 至少有一个稳定的 feature 文件
- 后续 pause 可以按单 domain 或单场景推进

### Phase 2 - Introduce Composition Root

Deliverables:

- main bootstrap 中显式的 container 初始化
- domain service 注册表
- controller 注册入口和业务实现解耦

当前状态：

- 已引入 `MainCompositionRoot`，使用 `tsyringe` child container 装配 main-side 启动上下文。
- `src/main/index.ts` 保留 Electron 生命周期、窗口创建、数据库启动和退出清理。
- IPC handlers 仍保持现有函数式实现，后续 phase 再按 domain 迁移为 controller/service。

Exit criteria:

- `src/main/index.ts` 只负责生命周期和组装
- domain controller 不再在文件内部直接拼装所有依赖

### Phase 3 - Migrate Leaf Domains First

优先迁移副作用小、边界短的 domain：

- `external-links`
- `native-menu-bar`
- `launcher-history`
- `local-start`

当前状态：

- `external-links` 已迁移为 `controller -> service`
- `native-menu-bar` 已迁移为 `controller -> service`
- `launcher-history` 已迁移为 `controller -> service -> repository`
- `local-start` 已迁移为 `controller -> service -> repository`
- `launcher` 对 local start / launcher history 的使用已改为从 composition root 注入 service
- 当前没有为这次迁移保留兼容 wrapper

Exit criteria:

- 这些 domain 的 controller 只剩 IPC 适配
- service 逻辑已从 handler 文件移出

### Phase 4 - Migrate Settings / Models / Workspace / Shortcuts

这个阶段开始收口配置类和偏好类状态。

当前状态：

- `shortcuts` 已迁移为 `controller -> service`
- shortcuts 的 bootstrap 同步读取、设置持久化、全局快捷键重绑和 `settingsChanged` 广播已经从 IPC 文件收口到 service
- `workspace` 已从 `models.ts` 中分离，迁移为 `controller -> service -> repository`
- `threads:create` 通过注入的 `WorkspaceService` 读取全局 workspace，不再从 `models.ts` 跨域获取 workspace 状态
- `model-provider` 已迁移为 `controller -> service`
- `models:*` IPC 已从 `models.ts` 分离到 model-provider controller
- `threads:create` 通过注入的 `ModelProviderService` 读取默认模型，不再从 `models.ts` 跨域获取模型状态
- `settings` 已迁移为 `controller -> service`
- `app:version` 已从旧 `models.ts` 分离到 `app-info` controller
- 旧 `src/main/ipc/models.ts` 已删除

Exit criteria:

- settings 与 models 不再混在同一个 handler 文件里
- workspace 逻辑从 `models.ts` 中分离
- shortcuts 的 bootstrap 与持久化边界明确

### Phase 5 - Migrate Threads / Artifacts / Main Window Routing

这是 main-side 的核心产品流。

当前状态：

- `artifacts` 已迁移为 `controller -> service`
- artifact list / open / readFile / readBinaryFile IPC 适配已从 `ipc/artifacts.ts` 收口到 artifacts controller
- `artifacts:changed` renderer 广播桥已从旧 IPC 文件移到 artifacts controller
- `main-window-routing` 已迁移为 `controller -> service`
- `main-window:*` IPC 的 open / openThread / pending navigation / ackNavigation 已从 `ipc/main-window.ts` 收口到 main-window-routing controller
- `threads` 已迁移为 `controller -> service`
- `threads:*` IPC 适配已从 `ipc/threads.ts` 收口到 threads controller
- `threads` 对默认模型、workspace、settings、artifacts 的依赖已改为注入对应 service

Exit criteria:

- `threads` controller 不再直接做 DB、runtime、artifact、search index 编排
- artifact 访问边界收口
- main window navigation 保持行为不变

### Phase 6 - Migrate Launcher And Native Extensions

当前状态：

- `launcher` 已迁移为 `controller -> service`
- `launcher:*` IPC 适配已从 `windows/launcher-window.ts` 收口到 launcher controller
- launcher window 文件只保留窗口创建、显示、viewport 调整等窗口语义
- launcher search / clipboard / executeAction / history side effects 已移入 launcher service
- `native-extensions` 已迁移为 `controller -> service`
- `nativeExtensions:*` IPC 适配已从 `ipc/native-extensions.ts` 收口到 native-extensions controller
- native extension settings schema / preferences / invoke / preferencesChanged 广播已移入 native-extensions service

Exit criteria:

- launcher handler 保持窗口语义，但业务逻辑移入 service
- native extension preferences / invoke / event broadcast 有独立 service

### Phase 7 - Migrate Agent Runtime Last

`agent` 是最高风险域，最后迁移。

当前状态：

- `agent` 已迁移为 `controller -> service`
- `agent:*` IPC 适配已从 `ipc/agent.ts` 收口到 agent controller
- agent controller 负责 Electron `IpcMain`、`BrowserWindow`、stream channel sink
- agent service 负责 active run、invoke、cancel、resume、interrupt、HITL 持久化和 run 状态同步
- agent service 不直接依赖 Electron 原始 event 或 `BrowserWindow`

Exit criteria:

- 流式运行、取消、恢复、审批恢复行为全都有 BDD 或等价高价值测试覆盖
- runtime service 不直接耦合 IPC 层

### Phase 8 - Remove Temporary Paths

当前状态：

- 未引入迁移期兼容注册、双写或过渡 shim
- `settings-window-routing` 已迁移为 `controller -> service`
- `settings:*` 窗口路由 IPC 已从最后一个旧 `ipc/settings-window.ts` 收口到 settings-window-routing controller
- `src/main/ipc` 下已无剩余 tracked handler 文件
- 迁移期空台账文件已删除

Deliverables:

- 删除兼容注册方式
- 删除双写和过渡 shim
- 删除迁移期空台账文件

Exit criteria:

- container 成为唯一装配入口
- 不再保留迁移期兼容代码

## Order Constraints

- Phase 1 必须先于任何大规模迁移。
- Phase 2 完成前，不做跨多个 domain 的统一抽象。
- Phase 7 必须最后做。
- Phase 8 只有在所有目标 domain 都稳定后才能开始。

## Acceptance

这个长期任务完成时，必须同时满足：

- main process 的主要 domain 都有可执行的 BDD 门禁
- 每次 pause 都能以一个 feature 或一个场景为验收单位
- `tsyringe` 只负责装配，不污染 renderer 和 preload 边界
- IPC handler 文件明显变薄
- 没有未清理的迁移债务
