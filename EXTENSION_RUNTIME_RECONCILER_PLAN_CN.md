# Extension Runtime + React Reconciler 技术方案

## 目标

把当前内置在 renderer 里的 extension UI 迁到独立 extension runtime 中执行，同时保持现有 GitHub、Apple Reminders、Todo List 命令可用。

当前这些 extension 暂时仍放在 `src/extensions/**`，这是源码组织上的内置，不代表执行上继续内置到 launcher renderer。方案完成后：

- GitHub、Apple Reminders、Todo List 的 React 代码在 extension runtime 中运行。
- Launcher renderer 不再 import 这些 extension 的 command React 模块。
- Extension 可以继续使用 React hooks，包括 `useState`、`useEffect`、`useMemo`。
- Extension JSX 通过自定义 React reconciler 输出 serializable render tree。
- Renderer 只负责把 render tree 渲染成 Openwork 原生 launcher surface。
- Menu bar / no-view command 不常驻 session，按需短跑并缓存宿主 surface。

Translate extension 目前依赖 `useAI` / `useI18n` 等 renderer/AI 边界。第一阶段允许它继续走 legacy renderer path，保证现有功能不被打断；等 AI bridge 定义清楚后再迁入 runtime。

## 当前问题

现状里 `src/extensions/github/renderer.ts`、`src/extensions/apple-reminders/renderer.ts`、`src/extensions/todo-list/renderer.ts` 会直接 import command React 模块，然后 `src/renderer/src/extension-host/index.ts` 再把这些模块注册进 launcher route。

这带来几个边界问题：

- Extension React 代码实际运行在 launcher renderer。
- `List`、`ActionPanel`、`Detail`、`Form` 等组件靠 `React.Children` + marker role 扫描。
- Action callback、menu bar callback 是 renderer 内闭包，不能跨进程。
- `PassiveCommandHosts` 会把 menu-bar/background command 作为隐藏 React 组件常驻在 launcher renderer。
- Todo 直接用 `window.localStorage`；GitHub / menu bar 代码直接用 `window.api`、`window.open`。

这些都不适合未来把 extension 抽成外部包或第三方生态。

## 边界定义

### Extension Runtime Process

职责：

- 执行 extension JS。
- 持有 extension React state、effects、navigation stack。
- 通过 React reconciler 把 JSX commit 成 serializable render tree。
- 把 action callback、form callback、dropdown callback 注册成 runtime event id。
- 通过 host capability bridge 请求设置、RPC、存储、导航、打开链接等能力。

不负责：

- 不直接渲染 DOM。
- 不 import renderer 组件。
- 不直接访问 `window.api`。
- 不拥有 launcher selection / hover / footer shortcut 的视觉实现。

### Main Process

职责：

- 管理 extension runtime process 生命周期。
- 加载 extension manifest、metadata、runtime modules。
- 代理 host capabilities：preferences、RPC、storage、openExternal、settings、launcher navigation、native menu bar。
- 维护 menu bar cached surface 和 scheduled run。
- 在 runtime 崩溃时给 renderer 返回明确错误状态。

### Launcher Renderer

职责：

- 渲染 launcher chrome、list、detail、form、action overlay。
- 接收 render tree snapshot。
- 把用户事件转成 runtime event：input change、dropdown change、form change、action execute、selection change。
- 不执行 extension command React 代码。

## 进程模型

第一阶段使用一个 foreground runtime session，不做每个 extension 常驻进程。

```text
Launcher Renderer
  -> Main RuntimeManager
    -> Extension Runtime Process
```

运行模式：

- `view` command：启动 foreground session，直到用户离开 command。
- `no-view` command：`runOnce`，函数返回后销毁。
- `menu-bar` command：`runOnce`，输出 menu bar surface 后销毁；宿主缓存最后状态。

后续如果出现真实长期任务，再单独引入 explicit background service，不把它混进第一版。

## React Reconciler 方案

新增 `react-reconciler` 依赖。Extension API 组件不再是 renderer UI 组件，而是 runtime host elements。

Extension 代码仍然写：

```tsx
export default function TodoList() {
  const [items, setItems] = useState([])

  return (
    <List navigationTitle="Todo List">
      <List.Item
        title="Write plan"
        actions={
          <ActionPanel>
            <Action title="Complete" onAction={() => setItems([])} />
          </ActionPanel>
        }
      />
    </List>
  )
}
```

Runtime reconciler commit 后输出：

```ts
type ExtensionSurfaceSnapshot =
  | ExtensionListSurface
  | ExtensionDetailSurface
  | ExtensionFormSurface
  | ExtensionMenuBarSurface
  | ExtensionEmptySurface
  | ExtensionErrorSurface
```

函数不能跨 IPC，所以所有 callback 都变成 event id：

```ts
interface ExtensionActionNode {
  id: string
  title: string
  style?: "regular" | "destructive"
  icon?: ExtensionVisualNode
  sectionTitle?: string
}
```

renderer 执行动作时只发：

```ts
{
  type: "event",
  sessionId: "...",
  event: {
    type: "action.execute",
    actionId: "action:3"
  }
}
```

runtime 收到后调用原闭包，然后 React state 更新，再发新 snapshot。

这里的 snapshot 只代表 extension 输出的结构状态，不代表所有交互都要跨进程 roundtrip。高频交互必须归 launcher renderer 本地处理，见“性能模型”。

## Render Tree 协议

新增文件：

```text
src/shared/extension-runtime-protocol.ts
```

核心类型：

```ts
interface ExtensionRuntimeLaunchContext {
  commandName: string
  commandPreferences: Record<string, unknown>
  extensionName: string
  extensionPreferences: Record<string, unknown>
  initialAction: "focus" | "open" | "submit"
  mode: "view" | "no-view" | "menu-bar"
  seedQuery: string
}

type ExtensionRuntimeToHostMessage =
  | { type: "ready"; sessionId: string }
  | { type: "surface"; sessionId: string; surface: ExtensionSurfaceSnapshot }
  | { type: "host-request"; request: ExtensionHostRequest }
  | { type: "error"; error: ExtensionRuntimeError }

type ExtensionHostToRuntimeMessage =
  | { type: "start"; context: ExtensionRuntimeLaunchContext }
  | { type: "event"; event: ExtensionRuntimeEvent }
  | { type: "host-response"; response: ExtensionHostResponse }
  | { type: "stop" }
```

第一版发送 full snapshot，不做 patch stream。这个 full snapshot 只用于低频结构更新，例如列表数据变化、loading/error 切换、表单结构变化、detail 内容变化。等 surface 大到需要优化时再引入 patches。

## 性能模型

核心原则：

```text
高频交互归 host
低频结构更新归 runtime
```

不能把 extension runtime 做成“每次用户交互都等 runtime 回包”。否则输入、hover、selection、footer shortcut 都会有卡顿风险。

### Host 本地状态

这些状态归 launcher renderer，本地即时响应：

- 输入框正在显示的文本。
- 鼠标 hover 行。
- 键盘 selection index。
- 当前 action overlay 是否打开。
- footer shortcut 的视觉布局和高亮。
- selected row scroll into view。

用户输入时流程必须是：

```text
keydown
  -> renderer 立即更新 input value
  -> renderer 异步发送 query changed event
  -> runtime 计算新的 result structure
  -> renderer 收到 snapshot 后替换结果区
```

禁止做成：

```text
keydown
  -> 发给 runtime
  -> runtime setState
  -> snapshot 回来
  -> input 才显示新字符
```

### Runtime 结构状态

这些状态归 extension runtime：

- extension React state。
- 当前 List / Detail / Form / MenuBar 的结构。
- List rows / sections / empty view / loading / error。
- Action descriptors。
- Form field values 的 extension 语义状态。
- navigation stack。

Runtime 发出的 snapshot 必须是结构数据，不携带 renderer UI 状态。

### Snapshot 合并

Runtime 不能每个 commit 都马上发 IPC。必须做发送合并：

```text
React commit
  -> mark dirty
  -> queueMicrotask 或 requestAnimationFrame
  -> 只发送最后一版 snapshot
```

同一轮 state update 只发一次。连续网络状态变化、loading 切换、数据写入如果发生在同一 tick，应合并。

### 首版限制

第一版加明确限制：

- 单个 List snapshot 默认建议不超过 100 rows。
- GitHub 默认 `numberOfResults` 维持 25。
- 超过 100 rows 的 command 应做分页、Load More 或后续 virtualized surface。
- Detail markdown 只发送字符串，不发送任意 React subtree。
- icon / accessory 使用受限 `ExtensionVisualNode`，不发送任意 JSX。

### 性能指标

RuntimeManager 和 renderer host 必须记录这些开发期指标：

- snapshot byte size
- snapshot frequency
- runtime render duration
- IPC latency
- renderer apply duration
- dropped / superseded snapshot count

只有这些指标暴露出真实瓶颈时，才进入 patch stream。不要第一版提前实现复杂增量协议。

## Host Capabilities

Extension 不能直接碰 renderer/main 私有 API，只能通过 runtime SDK 请求宿主能力。

第一阶段需要：

- `preferences.getExtensionPreferences`
- `preferences.getCommandPreferences`
- `rpc.invokeNativeExtensionMethod`
- `storage.get / storage.set / storage.subscribe`
- `navigation.openCommand`
- `navigation.hideLauncher`
- `navigation.goHome`
- `launcher.show`
- `settings.openExtension`
- `shell.openExternal`
- `menuBar.setState`
- `scheduler.setBackgroundRefresh`

对应迁移：

- `createNativeExtensionClient` 改为 runtime host request，不再调用 `window.api.nativeExtensions.invoke`。
- `Action.OpenInBrowser` 改为 action node `{ kind: "openExternal", url }` 或 runtime host request。
- `openGitHubSettings` 改为调用 `settings.openExtension`。
- menu bar 中的 `window.api.launcher.show().then(openCommand)` 改为 `navigation.openCommand(address, { showLauncher: true })`。
- Todo 的 `window.localStorage` 改为 `useExtensionStorageState` 或 `storage` API。

## Runtime SDK

调整 `src/extensions/api.ts`，让它变成 runtime-safe SDK re-export。它不能 import renderer 私有实现。

建议结构：

```text
src/extension-runtime/
  entry.ts
  reconciler/
    host-config.ts
    render.ts
    normalize-surface.ts
  sdk/
    actions.tsx
    detail.tsx
    form.tsx
    list.tsx
    menu-bar.tsx
    navigation.ts
    preferences.ts
    rpc.ts
    storage.ts
```

`src/extensions/api.ts`：

```ts
export { Action, ActionPanel } from "@extension-runtime/sdk/actions"
export { Detail } from "@extension-runtime/sdk/detail"
export { Form } from "@extension-runtime/sdk/form"
export { List } from "@extension-runtime/sdk/list"
export { MenuBarExtra } from "@extension-runtime/sdk/menu-bar"
export {
  createNativeExtensionClient,
  useCommandSeedQuery,
  useExtensionStorageState,
  useNativeCommandPreferences,
  useNativeExtensionNavigation
} from "@extension-runtime/sdk"
```

现有 GitHub / Apple Reminders / Todo List 继续从 `../../api` import，迁移半径可控。

## Renderer Host

Renderer 新增 runtime surface renderer：

```text
src/renderer/src/extension-host/runtime/
  RuntimeExtensionSurface.tsx
  render-list-surface.tsx
  render-detail-surface.tsx
  render-form-surface.tsx
  render-menu-bar-surface.tsx
```

这些 renderer 复用现有优秀设计：

- `LauncherChrome`
- `LauncherResultList` 的行布局和 selected/hover 视觉
- `LauncherActionOverlay`
- `NativeSurfaceChrome` 中适合 detail/form 的 shell

老的 `React.Children` marker parser 只作为 legacy path 保留给 Translate；GitHub / Apple Reminders / Todo List 不再走它。

## Extension 注册

当前 `src/extensions/renderer.ts` 实际是把 command React module 注册进 renderer。迁移后拆成两类：

```text
src/extensions/runtime.ts
  runtime process 使用，import command modules

src/extensions/metadata.ts
  main/renderer 可用，只 import manifest + meta，不 import command components
```

Renderer 只需要知道：

- extension manifest
- command mode
- title / keywords
- viewport metadata
- search intent metadata
- 该 command 是否声明 runtime metadata

它不需要 command component。

## Launcher 接入

`LauncherCommandSurface` 当前通过 `activeViewCommand.Component` 渲染 extension command。

迁移后 extension command route 分成：

```ts
type LauncherViewCommandDefinition =
  | { kind: "built-in"; Component: ComponentType }
  | { kind: "legacy-extension"; Component: ComponentType }
  | { kind: "runtime-extension"; extensionName: string; commandName: string }
```

GitHub / Apple Reminders / Todo List 使用 `runtime-extension`。

Translate 第一阶段可继续使用 `legacy-extension`，直到 AI bridge 迁移。

## Menu Bar / No View

删除 GitHub / Apple Reminders 对 `NativeExtensionPassiveCommandHosts` 的依赖。

新的 menu bar 流程：

```text
main scheduler
  -> runOnce(menu-bar command)
  -> runtime renders MenuBarExtra surface
  -> main native-menu-bar service caches state
  -> runtime exits
```

菜单项被点击时：

```text
native menu bar item selected
  -> main starts runOnce(menu-bar command, initialEvent=itemSelected)
  -> runtime rerenders command
  -> runtime finds stable menu item action
  -> runtime executes callback
  -> host applies side effects / updates cached menu state
  -> runtime exits
```

因此 menu-bar action id 必须稳定。规则：

- 优先使用 React key。
- 没有 key 时用 section path + title。
- 动态数据项必须保留 key，例如 GitHub notification id、Reminder id。

`useBackgroundRefresh(callback, intervalMs)` 在 runtime 中不直接开 long-lived interval，而是向 main 注册：

```ts
{
  ;(commandKey, intervalMs)
}
```

Main 负责下一次唤醒 command。

## 当前 Extension 迁移清单

### GitHub

必须运行在 runtime：

- view commands：issues、pull requests、search、workflow、notifications、create issue、create PR、repositories。
- menu-bar command：`unread-notifications`。

当前状态：

- GitHub view commands 已在 manifest 声明 runtime metadata，并使用 runtime SDK / runtime client。
- `unread-notifications` 仍在 legacy renderer path，等待 menu-bar runtime 调度链路完成后再迁。

需要改动：

- view command 的 `openGitHubSettings` 已改为 runtime settings bridge。
- menu-bar action 中的 `window.open` 后续改为 `openExternal`。
- menu-bar action 中的 `window.api.launcher.show()` 后续改为 `navigation.openCommand(..., { showLauncher: true })`。
- Octokit 可以在 runtime process 中运行；token 从 preferences bridge 进入。

### Apple Reminders

必须运行在 runtime：

- view commands：`my-reminders`、`create-reminder`。
- no-view command：`quick-add-reminder`。
- menu-bar command：`menu-bar-reminders`。

需要改动：

- `createNativeExtensionClient` 改走 runtime RPC bridge，底层仍调用 main 中的 Apple Reminders service。
- menu-bar action 中的 launcher show/open command 改为 navigation bridge。
- menu-bar refresh 改由 main scheduler 唤醒。

### Todo List

必须运行在 runtime：

- view command：`index`。

需要改动：

- `window.localStorage` 改为 runtime storage API。
- 初始读取不能依赖浏览器同步 localStorage；使用 `useExtensionStorageState`，host 启动时把 command storage snapshot 放进 launch context。
- Todo 状态归属为 extension storage，不属于 launcher renderer。

### Translate

第一阶段保持 legacy renderer path，确保现有功能不被打断。

迁移 Translate 需要先定义：

- AI bridge
- locale/i18n bridge
- streaming state 如何进入 render tree

这不阻塞 GitHub / Apple Reminders / Todo List runtime 化。

## AI Capability / useAI 设计

Translate 不能长期作为 legacy exception。它迁入 runtime 前，必须先把 AI 能力从 renderer 私有 hook 中抽成 host capability。

当前 `src/renderer/src/ai-core/useAI.ts` 的 `useAI` 实际只是 renderer 内的 tool registry：

```text
useAI()
  -> registerTools(ownerId, tools)
  -> listRegisteredAiTools()
```

它不是通用模型调用 API，也不适合直接暴露给 runtime。Translate 当前真正的 LLM 调用走的是 `translateClient.translate()` RPC，最后在 main 里调用 `getChatModelInstance()`。这说明 AI 执行边界已经自然落在 main，只是 API 还没有抽象成通用 capability。

### 目标边界

`useAI` 应该变成 extension/runtime-safe SDK，背后通过 host capability 请求 main 的 AI service：

```text
extension runtime
  -> useAI()
  -> ai.generate / ai.stream / ai.invokeTask
  -> host request
  -> main ai service
  -> model provider
```

Renderer、extension runtime、agent middleware 都不应该各自直接拼模型调用逻辑。模型选择、provider credential、审计、取消、限流、streaming 都应该收口到 main 的 AI service。

### API 分层

第一层是低级模型 API：

```ts
interface AiGenerateRequest {
  messages: Array<{
    role: "system" | "user" | "assistant"
    content: string
  }>
  modelId?: string
  ownerId: string
  temperature?: number
}

interface AiGenerateResult {
  modelId: string
  text: string
}

interface AiCapability {
  generate: (request: AiGenerateRequest) => Promise<AiGenerateResult>
  stream: (request: AiGenerateRequest) => AsyncIterable<AiStreamEvent>
}
```

第二层是产品任务 API。Translate 不应该在 UI 里重复 prompt 拼装，而应调用可复用 task：

```ts
interface AiTaskCapability {
  translateText: (request: {
    modelId?: string
    sourceLanguage: string
    targetLanguage: string
    text: string
  }) => Promise<{
    modelId: string
    translatedText: string
  }>
}
```

这层可以被多处复用：

- Translate extension UI
- quick copy / no-view command
- agent tools
- future text selection action
- command palette search intent

### Runtime SDK 形态

`src/extensions/api.ts` 最终可以暴露：

```ts
export function useAI(): {
  generate: AiCapability["generate"]
  stream: AiCapability["stream"]
  translateText: AiTaskCapability["translateText"]
}
```

在 runtime 内它不直接 import `@renderer/src/ai-core`，而是调用 host request：

```ts
{
  type: "host-request",
  request: {
    capability: "ai",
    method: "translateText",
    payload: {
      modelId,
      sourceLanguage,
      targetLanguage,
      text
    }
  }
}
```

### Renderer useAI 的位置

现有 renderer `useAI` 应该改名或降级为更准确的名字：

```text
useAiToolRegistry
```

它处理的是“把某个 surface 的工具注册给 AI”，不是“调用 AI”。通用 `useAI` 名称应该留给 host capability SDK，避免未来 extension 作者误解。

### Translate 迁移方式

Translate 迁移到 runtime 时：

- `translateClient.translate()` 逐步替换为 `useAI().translateText()`。
- `translate/main/service.ts` 中的 `translateText()` 保留，但移动到 main AI task service，成为共享实现。
- `modelId` 仍从 command preference 读取，但解析 provider、检查 credentials、创建 model instance 都在 main。
- copy clipboard 通过 clipboard host capability，不直接用 `navigator.clipboard`。

### Streaming

第一版 Translate 可以继续非 streaming。`useAI().stream()` 只需要协议预留，不阻塞迁移。

如果后续做 streaming，runtime 不应每个 token 都触发完整 surface snapshot。应使用独立 stream channel：

```text
ai.stream token events
  -> runtime 合并文本状态
  -> 按 animation frame 合并 snapshot
```

或者让 renderer host 支持专门的 text stream node。这个等真实需要时再做。

### 失败语义

AI capability 失败必须在 main 标准化：

- provider 未配置
- modelId 无效
- provider API 错误
- 请求被取消
- rate limit

Runtime 只接收结构化错误，并决定显示在 extension surface 的 error state 里。

### 对其他地方的收益

这样设计后，`useAI` 不只服务 Translate：

- Extension 可以调用模型完成轻量任务。
- Agent middleware 可以复用同一批 task service。
- 内置 AI 页面仍可走更高阶 thread API，但底层 provider/model 选择一致。
- 后续第三方 extension 不需要知道 Openwork renderer 内部结构。

关键点是：`useAI` 不能是 renderer context hook；它必须是 runtime-safe host capability。

## 构建与打包

新增 runtime build entry：

```text
src/extension-runtime/entry.ts
```

构建产物：

```text
out/extension-runtime/entry.cjs
```

Electron main 通过 `utilityProcess.fork(runtimeEntryPath)` 启动。开发环境和打包环境都要能 resolve 到同一 entry。

如果 `utilityProcess` 打包路径受 asar 影响，runtime entry 需要放进 `asarUnpack` 或复制到 unpacked resource 目录。

依赖：

- 新增 `react-reconciler`，版本必须和当前 React 19.2.x 匹配。
- 不新增第二套 icon 库。
- 继续使用现有 `lucide-react`；runtime 对 SVG/icon ReactNode 做受限序列化。

## Icon / Accessories 序列化

当前 extension 大量使用：

```tsx
icon={<Plus className="h-4 w-4" />}
accessories={<span>Pinned</span>}
```

这些不能直接跨 IPC。

第一阶段提供受限 `ExtensionVisualNode`：

```ts
type ExtensionVisualNode =
  | { type: "text"; text: string }
  | { type: "icon"; name: string }
  | { type: "svg"; props: SerializableSvgProps; children: ExtensionVisualNode[] }
  | { type: "inline"; children: ExtensionVisualNode[] }
```

Reconciler 对 SVG host elements 做白名单序列化；renderer 再渲染成安全 React elements。不要传任意 HTML string。

如果某些 accessories 无法安全序列化，迁移时把它们改成 SDK 明确支持的 `List.Accessory` / text accessory。

## 失败语义

Foreground session：

- runtime 启动失败：renderer 显示 command error page。
- runtime 崩溃：main 结束 session，renderer 显示 extension crashed。
- action 失败：runtime 发 action error；renderer 显示 action 错误状态，session 不自动退出。

No-view：

- command 成功：runOnce resolve。
- command 失败：main 记录错误并可显示通知/日志，不污染 launcher renderer。

Menu bar：

- refresh 成功：更新 cached surface。
- refresh 失败：保留上一份 cached surface，标记 stale/error tooltip。
- item action 失败：保留 menu bar，记录错误。

## 验证方案

基础检查：

```bash
npm run doctor
npm run check:guardrails
npm run typecheck
```

涉及新增 runtime entry / 打包路径时补跑：

```bash
npm run build
```

新增 contract 检查：

- renderer 不能 import `src/extensions/*/src/**` command modules。
- runtime SDK 不能 import `src/renderer/**`。
- extension command modules 不能 import `@renderer/**`、`@launcher-shell/**`、`@extension-host/**`。
- GitHub / Apple Reminders / Todo List 的 runtime definitions 必须和 manifest commands 对齐。

行为测试：

- 打开 Todo List，创建 todo，关闭 command，再打开仍存在。
- 打开 GitHub command，未配置 token 时能打开 extension settings。
- 打开 Apple Reminders quick-add no-view，空 query 时跳转 create-reminder。
- Menu bar command refresh 后 native menu bar state 存在，不需要 renderer 隐藏组件常驻。
- 关闭 launcher renderer 时，runtime session 被 main 清理。

### Electron CDP 自验收

涉及真实 launcher 行为时，使用 `.agents/skills/openwork-electron-cdp` 的隔离实例流程，不碰用户当前运行的 Openwork：

```bash
.agents/skills/openwork-electron-cdp/scripts/start_isolated_electron_cdp.sh 9333
curl -sf http://127.0.0.1:9333/json/version
curl -sf http://127.0.0.1:9333/json
bun x agent-browser --session openwork-runtime --cdp 9333 snapshot -i
```

每个可交互阶段至少做一次 CDP 验收：

- launcher 能打开。
- 搜索框输入不卡，输入显示不依赖 runtime roundtrip。
- Todo List command 能进入 runtime surface。
- row hover / selection / footer shortcut 在 renderer 本地响应。
- action overlay 能打开并执行 runtime action。
- 关闭 command 后 foreground runtime session 被清理。

CDP 看不到 main process 内部，因此 runtime 生命周期仍要结合日志、类型检查和 contract 测试验证。

## 实施顺序

### Phase 0：边界和 contract 先落地

目标：先定义协议，不改变现有运行路径。

改动：

1. 新增 `src/shared/extension-runtime-protocol.ts`。
2. 定义 `ExtensionSurfaceSnapshot`、`ExtensionRuntimeEvent`、`ExtensionHostRequest`、`ExtensionHostResponse`。
3. 新增 serializer / visual node 类型。
4. 新增 architecture check：renderer 不得 import runtime command modules。
5. 保留现有 `github/renderer.ts`、`apple-reminders/renderer.ts`、`todo-list/renderer.ts`，不切流量。

验收：

```bash
npm run doctor
npm run check:guardrails
npm run typecheck
```

完成标准：

- 协议类型在 shared 层，不依赖 renderer/main 私有实现。
- 现有 extension 全部照常运行。
- contract check 能表达未来边界。

### Phase 1：Runtime SDK + reconciler 最小闭环

目标：让一个测试 command 在 runtime 中用 React hooks 渲染 List snapshot。

改动：

1. 新增 `src/extension-runtime/sdk/host-elements.ts`、`list.ts`、`actions.ts`。
2. 新增 `src/extension-runtime/reconciler/host-tree.ts`、`render.ts`、`snapshot.ts`。
3. 新增 reconciler host config，支持 `List`、`List.Section`、`List.Item`、`ActionPanel`、`Action`。
4. 实现 callback registry：action callback -> event id。
5. 实现 snapshot batching。
6. 先用测试 fixture command，不迁真实 extension。

验收：

```bash
npm run test:node:target -- tests/node/extension-runtime-reconciler.test.ts
npm run typecheck
npm run check:guardrails
```

完成标准：

- runtime 内 `useState` 能更新 snapshot。
- 同一 tick 多次 state update 只发最后一版 snapshot。
- action event 能回到 runtime 执行闭包。
- 同一个 snapshot 内 action id 全局唯一，renderer 回传不会歧义。

当前实现状态：

- 已完成 runtime SDK 的 `List`、`List.Dropdown`、`List.EmptyView`、`ActionPanel`、`Action` 最小组件。
- 已完成 in-memory React reconciler 到 `ExtensionSurfaceSnapshot` 的 List snapshot 编译。
- 已完成 action handler registry、snapshot batching、action id 唯一性测试。
- 暂未新增真正的 runtime process entry；该项并入 Phase 2 的 `RuntimeManager + utilityProcess`，避免在没有进程管理前放一个假入口。

### Phase 2：Main RuntimeManager

目标：main 能启动/停止 foreground runtime session。

改动：

1. 新增 `src/main/services/extension-runtime/runtime-manager.ts`。
2. 使用 `utilityProcess.fork()` 启动 runtime entry。
3. 定义 `startForeground`、`stopForeground`、`runOnce`。
4. 实现 runtime crash -> structured error。
5. 接入 host capability 最小集：preferences、storage、openExternal、settings。

验收：

```bash
npm run typecheck
npm run build
```

完成标准：

- foreground session 可启动、停止、崩溃清理。
- 打包路径能找到 runtime entry。
- renderer 还未切流量，现有功能不受影响。

### Phase 3：Renderer Runtime Host

目标：renderer 能显示 runtime snapshot，但交互状态留在 renderer 本地。

改动：

1. 新增 `RuntimeExtensionSurface.tsx`。
2. 新增 List surface renderer，复用 `LauncherChrome`、`LauncherResultList`、`LauncherActionOverlay`。
3. 输入框 value、hover、selection、footer/action overlay 留在 renderer。
4. renderer 事件异步发给 runtime，不阻塞输入显示。
5. 增加开发期 metrics：snapshot size、apply duration、IPC latency。

验收：

```bash
npm run typecheck
```

CDP 验收：

```bash
.agents/skills/openwork-electron-cdp/scripts/start_isolated_electron_cdp.sh 9333
bun x agent-browser --session openwork-runtime --cdp 9333 snapshot -i
```

完成标准：

- 测试 runtime List surface 能在 launcher 中显示。
- 输入框打字即时显示，不等待 runtime。
- hover/selection/action overlay 本地响应。

### Phase 4：Todo List 迁移

目标：第一个真实 extension 完整跑在 runtime。

改动：

1. Todo command 改为 runtime route。
2. `src/extensions/api.ts` 对 Todo 使用 runtime SDK。
3. Todo 的 `window.localStorage` 改为 `useExtensionStorageState`。
4. Renderer 不再 import `src/extensions/todo-list/src/index.tsx`。
5. Legacy renderer path 仍保留给其他 extension。

验收：

```bash
npm run check:guardrails
npm run typecheck
```

CDP 验收：

- 搜索 Todo List 并打开。
- 创建 todo。
- 关闭 command 再打开，todo 仍存在。
- hover/selection/footer 不错位。
- action overlay 能执行 complete/delete/pin。

完成标准：

- Todo React state 在 runtime。
- Todo 持久状态在 host storage。
- launcher renderer 不 import Todo command module。

### Phase 5：Detail / Form / Navigation

目标：支持 Apple Reminders view command 所需 surface。

改动：

1. Runtime SDK 增加 `Detail`、`Detail.Metadata`。
2. Runtime SDK 增加 `Form`、`Form.TextField`、`Form.TextArea`、`Form.Dropdown`、`Form.Checkbox`。
3. Runtime navigation stack 支持 `push` / `pop` / `goHome`。
4. Renderer 增加 detail/form surface renderer。
5. Form field 输入本地即时显示，语义 change event 异步发 runtime。

验收：

```bash
npm run typecheck
```

完成标准：

- Create form 能输入。
- Detail 能显示 markdown + metadata。
- navigation.push 能显示 runtime child surface。

### Phase 6：Apple Reminders 迁移

目标：Apple Reminders view / no-view 都跑 runtime。

改动：

1. `my-reminders`、`create-reminder` 切 runtime route。
2. `quick-add-reminder` 走 `RuntimeManager.runOnce`。
3. `createNativeExtensionClient` 改为 runtime RPC host request。
4. Apple Reminders main service 保持在 main。

验收：

```bash
npm run check:guardrails
npm run typecheck
```

CDP 验收：

- 打开 My Reminders。
- 打开 Create Reminder。
- quick-add 空 query 跳转 Create Reminder。
- reminder RPC 错误能显示在 surface，不崩 launcher。

完成标准：

- Apple Reminders renderer 不 import command modules。
- no-view command 不跑在 launcher renderer。

### Phase 7：GitHub 迁移

目标：GitHub view commands 跑 runtime。

改动：

1. GitHub view commands 切 runtime route。
2. `openGitHubSettings` 改为 settings host capability。
3. `Action.OpenInBrowser` / `window.open` 改为 openExternal capability。
4. GitHub client 继续在 runtime 使用 Octokit。
5. token / apiBaseUrl / numberOfResults 从 preferences bridge 注入。

验收：

```bash
npm run check:guardrails
npm run typecheck
```

CDP 验收：

- 未配置 token 时打开任一 GitHub command，能进入 settings。
- 配置缺失不会崩 launcher。
- 搜索 GitHub command 的 input 即时响应。
- action overlay 能打开外部链接。

完成标准：

- GitHub renderer 不 import command modules。
- GitHub command 错误状态在 runtime surface 内呈现。

### Phase 8：Menu Bar / scheduled run

目标：移除 GitHub / Apple Reminders 对 hidden passive React hosts 的依赖。

改动：

1. 删除 runtime command 对 `NativeExtensionPassiveCommandHosts` 的依赖。
2. Main scheduler 读取 menu-bar command refresh interval。
3. `menu-bar` command 走 `runOnce`，输出 `ExtensionMenuBarSurface`。
4. Main native-menu-bar service 缓存最后 state。
5. menu item selected 时短跑 command 并执行 stable action id。

验收：

```bash
npm run check:guardrails
npm run typecheck
```

完成标准：

- renderer 不再挂 GitHub/Apple menu-bar hidden component。
- menu bar state 由 main 缓存。
- runtime 不常驻 background session。

### Phase 9：AI Capability + Translate 迁移

目标：Translate 也迁入 runtime，并让 `useAI` 成为通用 host capability。

改动：

1. main 新增 AI task service：`generate`、`translateText`。
2. renderer 现有 `useAI` 重命名为 `useAiToolRegistry`。
3. runtime SDK 新增 `useAI()`，走 host capability。
4. Translate UI 改用 runtime SDK。
5. clipboard copy 改走 clipboard host capability。

验收：

```bash
npm run check:guardrails
npm run typecheck
```

CDP 验收：

- 打开 Translate。
- 输入文本不等待 runtime roundtrip。
- 执行翻译。
- copy result 走 host clipboard。

完成标准：

- Translate 不再走 legacy renderer path。
- `useAI` 不依赖 renderer context。
- AI task service 可被 extension、agent、其他 surfaces 共用。

### Phase 10：收尾清理

目标：删除历史包袱，防止新代码回到旧边界。

改动：

1. 删除或隔离旧 marker parser。
2. 删除 legacy extension renderer registry。
3. 加强 guardrail：runtime command 禁止 `window.api`、`window.localStorage`、`@renderer`、`@extension-host`。
4. 补 docs：extension author API、runtime lifecycle、capability list。
5. 审计 package 依赖。

验收：

```bash
npm run audit:frontend-packages
npm run check:guardrails
npm run typecheck
npm run build
```

完成标准：

- GitHub / Apple Reminders / Todo / Translate 都声明 runtime metadata。
- launcher renderer 只渲染 host surface。
- legacy path 不再是默认开发路径。

## 不做的事

第一阶段不做：

- 每个 extension 一个常驻进程。
- 第三方 extension 权限系统。
- 完整 Raycast API 兼容。
- render tree patch stream。
- 完整 action middleware 合并。
- Translate AI bridge 迁移。

这些都可以在 runtime/protocol 跑通后继续演进。

## 结论

这套方案的核心不是“把现有 children parser 搬到另一个地方”，而是把 extension 执行、React state、UI 渲染协议正式分层：

```text
extension React code
  -> runtime reconciler
  -> serializable render tree
  -> host renderer
  -> Openwork launcher UI
```

GitHub、Apple Reminders、Todo List 会先迁到 runtime；它们仍然可以使用 React，但不再运行在 launcher renderer。Menu bar 和 no-view 不常驻 background session，而是由 main scheduler 唤醒、缓存宿主 surface、短跑后销毁。
