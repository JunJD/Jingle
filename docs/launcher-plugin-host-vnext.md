# Launcher Plugin Host VNext 方案

## 背景

目标不是现在就把 `openwork` 变成完整的 Jingle/npm 插件平台，而是先把我们内部的 first-party plugin 机制做对，让后续接入 Jingle 插件时不需要重写 launcher 核心。

约束也要明确：

- 这一轮只做 launcher 内部插件宿主，不做插件市场、npm 安装、远程分发。
- 这一轮优先服务 `AI`、`translate` 这类 first-party plugin。
- 未来如果要兼容 Jingle，应该是在稳定的 core host 上做 compatibility adapter，而不是把 core host 直接做成 `window.rubick`。

## 工程评审结论

### P0. 现在的插件模型仍然把“插件”定义成“一个 React 页面”

当前 `LauncherPluginDefinition` 仍然以 `Component` 为核心，并且 route 只有单一 `pluginId`。

现状：

- `src/renderer/src/launcher/pages/types.ts`
- `src/renderer/src/launcher/pages/index.ts`
- `src/renderer/src/launcher/pages/ai.tsx`
- `src/renderer/src/launcher/built-plugins/sdk.ts`

结构问题：

- 它天然假设插件一定是 renderer 内部 React 组件。
- 它天然假设一个插件只有一个入口页。
- 它无法表达 Jingle 那种 `plugin -> features -> cmds` 的结构。

直接后果：

- 以后要接 Jingle 插件时，只能把一个 Jingle plugin 人工拆成多个 openwork plugin。
- 如果后面要支持 `webview/browserview/html entry`，现有 `Component` 中心模型会成为硬阻塞。

建议方向：

- 把“插件定义”升级成“插件包 + entry + runtime adapter”。
- route 不再只存 `pluginId`，而是存 `pluginId + entryId + seedQuery`。

### P0. manifest 不是真正的单一事实来源

现在 renderer 和 main 侧各有一份 registry，preload/IPC 也是单独接线。

现状：

- `src/renderer/src/launcher/built-plugins/index.ts`
- `src/main/services/built-plugins/index.ts`
- `src/main/ipc/built-plugins.ts`
- `src/preload/index.ts`

结构问题：

- 插件页面注册、插件 RPC 注册、插件 ID、插件可用能力，没有一份共享 manifest 统一描述。
- 现在更多是“几处并行数组刚好同名”，不是“系统保证它们一致”。

直接后果：

- 每加一个插件都要同时改 renderer/main/preload 多个地方。
- 审核成本高，因为 reviewer 很难判断哪些接线是必需，哪些是遗漏。

建议方向：

- 每个插件目录里必须有一份共享 manifest。
- renderer/main/preload 只消费 manifest 和各自 adapter，不再自行发明插件定义。

### P0. route 模型太粗，不适合 Jingle 的 feature 级接入

当前 route 是：

```ts
type LauncherRoute = { id: "home" } | { id: LauncherPluginId; seedQuery: string }
```

结构问题：

- route 把“插件”和“入口 feature”混成同一层。
- Jingle 的真正入口单位不是 plugin page，而是 `feature/cmd`。

直接后果：

- 一个插件多个入口时，home entry、intent、shortcut、history 都会开始打补丁。
- 未来 search result / history 恢复时无法稳定定位到具体 feature。

建议方向：

- 引入 `entryId`，route 变成：

```ts
type LauncherPluginRoute = {
  pluginId: string
  entryId: string
  seedQuery: string
}
```

### P1. host capability 现在是隐式全量开放，不适合未来外部插件

现状：

- `src/renderer/src/launcher/LauncherPluginHost.ts`
- `src/renderer/src/launcher/LauncherApp.tsx`

当前 host 直接给插件：

- navigation
- clipboard
- surface
- threads

结构问题：

- 插件拿到的是“完整 host”，不是“声明后拿到能力”。
- 对 first-party React page 这没问题，但对未来外部插件是不够安全、也不够可审核的。

直接后果：

- 难以知道某个插件实际依赖什么能力。
- 后面做 Jingle compatibility 时，bridge 会越来越像“全局大对象”，边界变糊。

建议方向：

- manifest 显式声明 capabilities。
- host runtime 只按 capability 注入可用 API。
- compatibility adapter 再把这些 capability 映射成 `window.rubick.*`。

### P1. `builtPlugins.invoke` 已经像 RPC，但还不是一个可审计的 plugin contract

现状：

- `src/shared/built-plugins/sdk.ts`
- `src/main/services/built-plugins/sdk.ts`
- `src/main/services/built-plugins/index.ts`

结构问题：

- 现在只有 `pluginId + method + payload`。
- method 没有 manifest 声明，没有 capability 约束，也没有版本边界。

直接后果：

- reviewer 很难知道插件到底暴露了哪些宿主方法。
- 后面如果要让外部 runtime 走这条桥，风险会很快放大。

建议方向：

- 保留这条 RPC 思路，但把方法声明搬进 plugin package。
- registry 在启动时校验：manifest 声明了哪些 methods，main adapter 是否都实现。

### P2. 目前已经有双轨制，继续扩展会越来越难收口

现状：

- `AI` 还在旧 `pages/ai.tsx`
- `translate` 已经在 `built-plugins`

结构问题：

- 这是两套 authoring model。
- 继续加第三个插件时，团队会再次面临“应该走哪套”的选择。

建议方向：

- 下一步不应再加新 authoring model。
- 先把 `AI` 迁入新插件包结构，再继续扩功能。

## 目标设计

### 1. 核心原则

- core host 只定义稳定的插件宿主协议，不直接绑定 Jingle 的全局 API 形状。
- Jingle 兼容通过 adapter 实现，不污染 core host。
- 插件的最小单元是 `plugin package`，插件对外暴露的是一个或多个 `entry`。
- search/home/shortcut/history 统一围绕 `entry` 工作，而不是围绕 page 特判。
- renderer/main/preload 都从同一个插件包描述出发。

### 2. 目标模块图

```text
plugin package
  -> shared manifest
  -> renderer runtime adapter
  -> main rpc adapter
  -> optional jingle compatibility adapter

launcher shell
  -> plugin registry
  -> route(entry-level)
  -> host capabilities
  -> search/home/history adapters

external compatibility
  -> jingle bridge on top of host capabilities
```

### 3. 推荐的插件包结构

建议把插件从 `renderer/main/shared` 的散落文件，收成按插件聚合：

```text
src/plugins/
  ai/
    manifest.ts
    renderer.tsx
    main.ts
    types.ts
  translate/
    manifest.ts
    renderer.tsx
    main.ts
    types.ts
```

如果不想一次搬目录，也至少要做到：

- 每个插件有独立 `manifest.ts`
- renderer/main 都从这个 manifest 派生注册

### 4. 推荐的 manifest 形状

```ts
type LauncherPluginManifest = {
  pluginId: string
  displayName: string
  runtime: "internal-react" | "external-webview"
  capabilities: LauncherCapability[]
  entries: LauncherPluginEntryManifest[]
  rpc?: {
    methods: string[]
  }
}

type LauncherPluginEntryManifest = {
  entryId: string
  title: string
  subtitle?: string
  home?: {
    label: string
    shortcutLabel?: string
  }
  search?: {
    matchIntent: (query: string, context: LauncherPluginTextContext) => LauncherPluginIntent[]
    resolveCommand?: (params: LauncherPluginCommandParams) => LauncherPluginCommandMatch | null
  }
  viewport: {
    bodyHeight?: number
    getHeight?: (shellConfig: LauncherShellConfig) => number
  }
}
```

这里最重要的不是字段名，而是这几个边界：

- `pluginId` 和 `entryId` 分开
- `runtime` 单独声明
- `capabilities` 单独声明
- `entries` 是 search/home/shortcut/history 的统一来源
- `rpc.methods` 显式声明

### 5. 推荐的 host capability 分层

建议把 host API 分成四层，不要继续堆成一个大对象：

- `navigation`
  - `goHome`
  - `hideLauncher`
  - `openEntry`

- `surface`
  - `inputRef`
  - `inputStatus`
  - `setInputStatus`
  - `viewportHeight`
  - `setViewportHeight`
  - `shownSequence`

- `clipboard`
  - `context`
  - `clearContext`

- `threadRuntime`
  - `create`
  - `submit`

以后如果要接 Jingle，再额外提供 compatibility mapping：

- `setSubInput/removeSubInput/setSubInputValue` 映射到 `surface`
- `setExpendHeight` 映射到 `surface.setViewportHeight`
- `onPluginEnter/onPluginOut/onShow/onHide` 映射到 lifecycle

### 6. Jingle 接入策略

不要把 core host 直接做成 `window.rubick`。

正确顺序应该是：

1. 先把 openwork 内部插件协议稳定下来。
2. 再做 `JingleCompatBridge`，把 core host 映射成 Jingle 风格 API。
3. 最后如果需要，再支持外部 html/webview 插件 runtime。

这样做的好处：

- 内部 React 插件不会被 Jingle 的历史包袱污染。
- 外部 Jingle 插件接入时，也只是在边缘层加 adapter。
- 核心 launcher shell 仍然保持 typed contract。

### 7. renderer / main / preload 的职责

#### renderer

- 负责 route、search result、page render、lifecycle 分发
- 不直接知道 main 里有哪些插件方法实现
- 只通过 plugin registry 看到 manifest 和 renderer adapter

#### main

- 负责 plugin RPC、窗口能力、未来 external runtime 装载
- 不直接知道 renderer page 如何实现
- 只通过 plugin registry 看到 manifest 和 main adapter

#### preload

- 只暴露稳定桥接：
  - `plugin.invoke`
  - 未来的 `plugin.runtime` / `plugin.host`
- 不承载业务判断

## 近期不做

- npm 插件安装/卸载
- 插件市场
- 远程插件分发
- 完整复刻 Jingle 的全部 `window.rubick` API
- 让外部插件直接拿到 openwork 内部 threadContext

## 推荐实施顺序

### Phase 1. 收口 first-party plugin contract

目标：

- 内部插件只剩一种写法
- manifest 成为单一事实来源
- route 升级到 `pluginId + entryId`

交付：

- `AI` 迁入新插件包结构
- `translate` 保持在新结构
- `pages/ai.tsx` 这类旧定义删除

### Phase 2. 加 capability 和 registry 校验

目标：

- 宿主能力显式化
- 插件方法可审计

交付：

- manifest capability 校验
- rpc method 校验
- pluginId/entryId 唯一性校验

### Phase 3. 做 Jingle compatibility adapter

目标：

- 不改 core host，就能跑一层 Jingle 风格桥接

交付：

- lifecycle adapter
- `subInput` adapter
- `setExpendHeight` adapter
- 外部 runtime 可行性验证

## TODO

### P0

- [x] 新建共享 `LauncherPluginManifest` / `LauncherPluginEntryManifest`
- [x] 把 route 从 `pluginId` 升级到 `pluginId + entryId`
- [x] 把 home entry / intent / shortcut / history 统一切到 entry 级模型
- [x] 给每个插件补独立 `manifest.ts`
- [x] 让 renderer registry 从 manifest + renderer adapter 注册
- [x] 让 main registry 从 manifest + main adapter 注册
- [x] 把 `AI` 迁到新插件包结构
- [x] 删除旧 `pages/ai.tsx` authoring path

### P1

- [x] 给 manifest 加 `capabilities`
- [x] 按 capability 注入 host API
- [x] 给插件 RPC 方法加 manifest 声明
- [x] 启动时校验 pluginId / entryId / rpc methods
- [x] 预留 manifest-only registry seam，供未来 Jingle adapter 消费
- [ ] 统一 `plugin.invoke` 命名，逐步替代 `builtPlugins.invoke`

### P2

- [ ] 设计 `JingleCompatBridge`
- [ ] 设计 `surface <-> subInput` 映射
- [ ] 设计 `viewport <-> setExpendHeight` 映射
- [ ] 设计 lifecycle 映射：`onEnter/onLeave/onShown/onHide`
- [ ] 验证一个最小 Jingle 风格插件在 openwork 中跑通

## 给 coder 的直接落地指令

第一批实现不要追求“开放插件”，只做这几件事：

1. 抽 shared manifest
2. 把 route 改成 entry 级
3. 把 `AI` 迁进新插件包结构
4. 让 renderer/main registry 都从 manifest 出发
5. 不做 marketplace，不做 npm loader，不做 external runtime

如果第一批做完后还有时间，再补 capability 校验；不要在第一批里同时做 Jingle compatibility bridge。
