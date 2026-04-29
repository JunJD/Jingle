# Extension Runtime Migration Plan

本文档记录当前 launcher / native extension runtime 的迁移依据。它不是旧版 phase roadmap 的复活，而是把本轮讨论里已经达成的产品要求、工程边界、当前状态和下一步执行顺序落成可检查的计划。

## 背景

Openwork 当前正在把内置在 renderer 里的 native extension command，逐步迁移到独立的 extension runtime 模型。

目标不是为了做一个抽象平台，而是解决几个真实问题：

1. extension 作者可以写接近 Raycast 风格的 React 组件和 hooks
2. extension 逻辑不继续散落在 launcher renderer 里
3. renderer 只负责显示 runtime snapshot，不拥有 extension 执行状态
4. main/runtime 对 action、storage、capability、lifecycle 保持权威
5. 未来如果从 Electron 换成 Tauri，extension core 不需要被重写

当前可以把工作分成四层，而不是继续用口头的 `phase4 / phase5`：

1. runtime 基础层
2. command manifest runtime metadata
3. 真实 extension 迁移层
4. capability bridge 层

## 原始产品要求

Launcher 搜索和 extension surface 要保持同一套信息架构。

搜索结果列表的要求：

- 选中态使用整行浅灰圆角胶囊
- 不使用左侧 border 表示选中
- 不把选中项做成独立卡片
- `Ask AI` 可以作为 Results 的第一项存在
- `Ask AI` 和普通结果共用同一套行布局
- 左侧只保留 icon，不保留 `对话` / `AGENT` 这类文字列
- 右侧固定一列显示 `Agent` / `Application` / `Command` / `打开`
- 企业级感来自对齐、稳定列宽和稳定信息架构，而不是装饰
- 底部命令栏可以保留 Raycast 式快捷键，但中文文案应是 `发给 AI`、`打开`、`动作`

这意味着 extension runtime 产出的 snapshot 不能只考虑“能渲染”，还必须能让 launcher shell 用稳定布局渲染：标题、副标题、icon、accessories、action、右侧类型列都要是明确字段，而不是 renderer 临时猜。

## 当前状态

当前 runtime 基础层已经存在，主要锚点如下：

- SDK：`src/extension-runtime/sdk/**`
- reconciler：`src/extension-runtime/reconciler/**`
- runtime entry：`src/extension-runtime/entry.ts`
- main runtime service：`src/main/services/extension-runtime/**`
- preload bridge：`src/preload/api/extensionRuntime.ts`
- renderer surface：`src/renderer/src/extension-runtime/RuntimeExtensionCommandSurface.tsx`
- runtime protocol：`src/shared/extension-runtime-protocol.ts`

当前 runtime command 的事实来源是 command manifest 上的 `runtime` 字段：

- `src/extensions/*/manifest.ts`

带有 `command.runtime` 的 command 会由 launcher renderer 路由到 extension runtime surface；没有该字段的 command 仍走 legacy renderer path。

截至本文档最近更新，以下 command 已声明 runtime metadata：

- `todo-list:index`
- `apple-reminders:my-reminders`
- `apple-reminders:create-reminder`
- `github:create-issue`
- `github:create-pull-request`
- `github:my-issues`
- `github:my-latest-repositories`
- `github:my-pull-requests`
- `github:my-starred-repositories`
- `github:notifications`
- `github:search-issues`
- `github:search-pull-requests`
- `github:search-repositories`
- `github:workflow-runs`

Apple Reminders 的 `quick-add-reminder` / `menu-bar-reminders` 和 GitHub 的 `unread-notifications` 仍保留在 legacy renderer path，等待 `runOnce` / menu bar runtime 调度链路接入后再迁。Translate 仍需要按下面计划处理。

## 模块边界

### Extension SDK

职责：提供 extension 作者使用的 API。

输入：extension React tree、SDK hooks、component props。

输出：host tree，由 custom reconciler 接管。

约束：

- SDK 不 import renderer / main / preload 私有实现
- SDK 不暴露 launcher 私有组件
- SDK 只表达 extension 想渲染什么、想请求什么 capability
- `List`、`Action`、`Icon`、`useExtensionStorageState` 等属于 author API

### Reconciler And Host Tree

职责：把 extension React tree 变成 Openwork host tree。

输入：React render/update。

输出：host nodes，以及每次提交后的 surface snapshot。

约束：

- React placement 语义必须严格，不允许 insert/remove 静默降级
- host props 不能被误认为一定可跨进程序列化
- action callback 留在 runtime 侧，renderer 不拿函数
- JSX icon 可以作为 custom host child 被序列化为 visual node

### Snapshot Protocol

职责：跨 runtime 和 renderer 传递可显示、可执行的纯数据。

输入：host tree。

输出：`ExtensionSurfaceSnapshot`。

约束：

- snapshot 是 renderer 唯一可信的 extension UI 输入
- action id 必须带 revision，避免旧 renderer 事件命中新 snapshot 的 callback
- renderer 发起 action 时必须携带同一个 revision
- stale action event 必须被 runtime 拒绝
- snapshot 字段应服务稳定布局，而不是让 renderer 猜结构

### Main Runtime Service

职责：管理 runtime 生命周期、storage、capability、IPC。

输入：renderer command open/close/action request。

输出：runtime process lifecycle、snapshot stream、action execution result。

约束：

- main 是 runtime 会话和 durable 状态的权威边界
- extension storage 不归 renderer 所有
- host capabilities 显式注册，不能变成全局隐式对象
- runtime crash / command missing / denied capability 要有明确失败语义

### Renderer Surface

职责：显示 snapshot，收集用户输入，把 action 事件发回 runtime。

输入：`ExtensionSurfaceSnapshot`、用户键盘/鼠标操作。

输出：`action.execute`、search query、selection change。

约束：

- renderer 不 import runtime command module
- renderer 不执行 extension callback
- renderer 只根据 snapshot 渲染 UI
- selection、hover、command bar 要复用 launcher 已有的好设计
- `List.filtering={false}` 时 renderer 不能强行本地过滤

## 为什么需要 Custom Reconciler

只处理 `children` 可以跑通少量内置 extension，但它有明显边界：

- 只能服务内置代码，难以支持未来打包进来的 extension
- extension React state、hooks、re-render 语义没有一个稳定宿主
- runtime 和 renderer 不分离时，callback、storage、AI、action 很容易混在 UI 层
- 不能自然得到 React placement/update/unmount 生命周期

custom reconciler 的价值是：

- extension 可以继续写 `useState` / `useMemo` / 自定义 hooks
- React state 更新后由 runtime 生成新 snapshot
- renderer 不需要理解 extension React tree
- action callback 留在 runtime，不跨 IPC
- 未来 extension 可以从 renderer 内置实现迁到 worker / utility process / 独立进程

这不是为了炫技。判断它值不值得的标准是：真实 Todo、Reminders、GitHub 迁过去以后，代码边界是否更清楚、bug 是否更容易定位、renderer 是否真的不再 import command 实现。

## Runtime 形态

第一阶段 runtime 可以继续放在当前仓库里，减少打包和发布负担。但逻辑上应视为独立运行环境。

推荐方向：

1. main 管理 runtime session
2. runtime 负责执行 extension command 和 React reconciler
3. renderer 只显示 snapshot
4. preload 只暴露受控 IPC bridge

是否每个 extension 一个 worker / process，不在当前阶段提前定死。当前更重要的是把接口做对：

- runtime session id
- command identity
- snapshot revision
- action execute contract
- storage namespace
- host capability request

进程模型后续可以从单 runtime process 演进到 per-extension worker 或 per-command worker，只要上述 contract 稳定。

## Extension Migration Plan

### Step 1: Todo 保持 runtime command 可用

Todo 是第一条真实链路，用来验证 runtime 基础层。

验收条件：

- `todo-list:index` 在 manifest command 上声明 `runtime.viewport`
- renderer 不再 import Todo command module
- Todo list 能显示、更新、执行 action
- storage state 不丢失
- action revision 能拒绝 stale event
- JSX icon / accessory 能正常显示

### Step 2: Reminders 迁入 runtime

Reminders 用来验证更接近真实系统能力的 extension。

验收条件：

- command 在 manifest 上声明 `runtime.viewport`
- renderer 不 import Reminders command module
- reminder 创建、展示、完成等 action 仍可用
- 需要的 host capability 显式定义
- 失败时显示明确错误，而不是空白 surface

### Step 3: GitHub 迁入 runtime

GitHub 用来验证 secrets、network-like capability、provider action 的边界。

验收条件：

- command 在 manifest 上声明 `runtime.viewport`
- renderer 不 import GitHub command module
- access token 不作为普通 renderer state 泄漏
- provider action icon 和 custom JSX icon 正常显示
- open external / browser 类 action 有明确 host capability

### Step 4: Translate 暂留 legacy renderer path

Translate 当前依赖 `useAI` / `useI18n` 等 renderer/AI 边界。在 AI bridge 定义清楚前，不强迁。

这样做的影响：

- Translate 继续可用，不阻断当前产品功能
- runtime 迁移不会被 AI 边界拖慢
- 但 runtime 还不能宣称覆盖所有 extension 类型

Translate 迁移前必须先定义：

- `useAI` 在 extension runtime 里的调用模型
- AI request 的权限、取消、错误、流式返回语义
- i18n 文案来源和 locale 更新方式
- AI capability 是平台能力，不是 extension 私有实现

## Capability Bridge Plan

Capability bridge 是后续真正决定 runtime 是否可扩展的部分。

第一批需要明确的 capability：

- storage：extension namespace 下的持久状态
- open external：打开浏览器或系统 URL
- AI：模型调用、取消、错误、可选流式响应
- i18n：locale 和翻译资源
- secrets：GitHub token 等敏感信息
- notifications / reminders：系统提醒相关能力

设计规则：

- extension 只请求 capability，不直接 import 宿主实现
- main 判断 capability 是否允许
- renderer 不成为 capability 中转的权威层
- 每个 capability 都有明确失败语义
- 不为了未来所有可能能力提前做大而全抽象

## Tauri / Shell Replacement Goal

未来换基座不是当前目标，但现在的设计应该避免把 Electron 写死到 extension core 里。

边界目标：

- `extension-runtime/**` 不依赖 Electron API
- `shared/extension-runtime-protocol.ts` 是 shell-agnostic contract
- Electron IPC 只存在于 main/preload/renderer adapter 层
- renderer surface 不直接知道 runtime process 怎么启动

如果未来换 Tauri，理想替换范围是：

- runtime process launcher
- IPC transport adapter
- open external / storage / secrets 等 host capability adapter
- window sizing / command surface adapter

不应该重写：

- SDK component model
- reconciler host tree
- snapshot protocol
- extension command source

## Performance Position

runtime 每次 React state 更新都会生成新 snapshot，再发给 renderer。这个模型可以接受，但必须靠约束控制，而不是盲目套 Next.js hydration。

当前不是服务端渲染页面，不需要 Next.js 式 hydration。renderer 不接管 extension React tree，它只消费 snapshot。

性能原则：

- snapshot 是纯数据，保持小而稳定
- action callback 不进入 snapshot
- 大列表后续再做 windowing 或增量 patch，不在第一阶段提前复杂化
- 输入过滤优先在 renderer 做，但必须尊重 `List.filtering`
- runtime 更新频率如果成为问题，再引入节流或 patch protocol

验收方式：

- Todo / Reminders / GitHub 的常用列表操作不出现可感知卡顿
- action 执行不会因为 snapshot 更新打到旧 callback
- 大输入时 renderer 不做无意义重复计算

## Verification Plan

每次迁移 extension command，至少执行：

1. `npm run doctor`
2. `npm run check:guardrails`
3. `npm run typecheck`
4. runtime reconciler targeted tests
5. 对应 extension 的真实 UI 验收

涉及跨进程、窗口生命周期、IPC contract 的改动，应优先补 BDD。

CDP 验收可以使用：

- `.agents/skills/openwork-electron-cdp/SKILL.md`

重点检查：

- runtime command 能打开
- hover / selected 状态符合 launcher surface 规范
- command bar 快捷键对齐
- action 能执行且不会错位
- stale action event 不会执行新 snapshot 的 callback

## Open Risks

当前还没完全解决或仍需继续收口的点：

- GitHub secret 边界仍需要最终从普通 preference 语义里收干净
- `OpenInBrowser` / open external action 需要完整 host capability
- `useAI` / `useI18n` 还没有 runtime 版本
- runtime command 的错误 UI 需要统一
- 大列表性能还没有真实压力测试
- extension runtime 打包形态还没有最终定型

这些风险不阻止 Todo / Reminders / GitHub 迁移，但必须在对应 extension 用到能力前解决。

## Source Of Truth

后续判断一个 command 是否已经迁入 runtime，以对应 `src/extensions/*/manifest.ts` command 上的 `runtime` 字段为准。

后续判断 launcher / extension runtime 是否越界，以这些文档和检查为准：

- `docs/engineering-boundaries.md`
- `docs/extension-runtime-migration-plan.md`
- `.agents/skills/launcher-extension-guardrails/SKILL.md`
- `npm run doctor`
- `npm run check:guardrails`

如果对话里出现新的 “phase” 说法，必须回到本文档更新为明确 step、验收条件和代码锚点，否则不作为工程依据。
