# Extension Runtime 架构调研：外部包、运行时隔离与搜索生命周期

日期：2026-05-28

## 背景

Openwork 正在把内置 extension command 迁到更接近外部安装包的 runtime 模型。当前核心问题有三个：

1. bundled extension 未来如何 monorepo 化或外部包化；
2. extension 依赖应该由宿主自带，还是由 extension 自己声明和构建；
3. 当前 extension runtime 搜索时疑似每次输入都刷新页面，说明生命周期边界可能混乱。

本文基于官方文档、开源实现、本地 SuperCmd 代码和 Openwork 当前代码做判断，不把 Raycast 当成唯一答案。

## 结论

Openwork 当前 `extension-runtime` 的大方向是对的：

```txt
extension command code
  -> isolated runtime process
  -> host capability RPC
  -> serialized UI snapshot
  -> renderer renders host-owned UI
```

这条路和 VS Code、Theia、Figma、Shopify remote rendering 的共同方向一致：第三方或扩展代码不直接进入宿主 UI 私有层，而是通过明确 API、RPC、序列化 UI 或消息协议和宿主交互。

当前更需要修正的不是 runtime 架构，而是搜索生命周期：

```txt
搜索输入是 command session 内部状态
不是 route identity
不是 launch identity
不是 React component key
```

如果搜索每打一字都会触发 page refresh、remount 或 runtime restart，说明 `seedQuery` 或 live query 被错误地纳入了 route key / component key / foreground runtime effect 依赖。

## 调研来源

### VS Code

官方文档：[Extension Host](https://code.visualstudio.com/api/advanced-topics/extension-host)

VS Code 的扩展运行在 extension host 中，而不是直接跑在 workbench UI 内。它根据场景区分 local Node.js extension host、web worker extension host、remote extension host。这个模型的重点不是“进程形态必须完全一样”，而是：

- extension code 有独立执行宿主；
- workbench UI 不直接暴露给 extension；
- extension 通过 API 和主应用交互；
- 宿主可以按本地、Web、远程环境选择不同 extension host。

对 Openwork 的启发：extension runtime 独立出来是正确方向；renderer 不应该 import runtime command module，也不应该执行 extension callback。

### Eclipse Theia

官方文档：[Plugin API](https://eclipse-theia.github.io/theia/docs/next/documents/Plugin-API.html)

Theia 的 plugin API 和 VS Code 扩展模型接近，也强调 plugin host 和前端应用之间通过代理和 API 边界协作。Theia 的价值在于它是一个开源 IDE 平台，说明 VS Code 模型不是 VS Code 私有实现特例，而是一类可复用的插件宿主模式。

对 Openwork 的启发：`main / runtime / renderer` 分层是合理的。extension 作者 API 应该稳定，宿主内部实现可以替换。

### Electron utilityProcess

官方文档：[utilityProcess](https://www.electronjs.org/docs/latest/api/utility-process)

Electron 官方提供 `utilityProcess` 作为主进程启动独立子进程并进行消息通信的机制。它适合把需要 Node.js 能力但不应该混入 renderer 的工作放到隔离进程中。

对 Openwork 的启发：当前通过 `utilityProcess.fork` 启动 extension runtime 是合理的 Electron 原语，不是过度设计。

### Raycast

官方文档：

- [Lifecycle](https://developers.raycast.com/information/lifecycle)
- [Manifest](https://developers.raycast.com/information/manifest)
- [List](https://developers.raycast.com/api-reference/user-interface/list)
- [Window and Search Bar](https://developers.raycast.com/api-reference/window-and-search-bar)
- [CLI](https://developers.raycast.com/information/developer-tools/cli)

Raycast 对 Openwork 最有价值的是 author API 和 command 生命周期：

- command 由 manifest 声明；
- command 有 `view`、`no-view`、`menu-bar` 等运行模式；
- `List` 暴露 `searchText`、`onSearchTextChange`、`isLoading`、`throttle`；
- 搜索是 command 内部交互事件，不是重新打开 command。

对 Openwork 的启发：Raycast 风格 `List` 可以借鉴，但不能把搜索 query 当成 route identity。搜索应该在同一个 command session 里流动。

### Figma Plugins

官方文档：[How plugins run](https://developers.figma.com/docs/plugins/how-plugins-run/)

Figma plugin 的主代码在 sandbox 中运行，UI 在 iframe 中运行，两者通过 `postMessage` 通信。它没有把 plugin 主代码直接放进宿主 UI 线程，也没有让 plugin 直接任意访问宿主内部。

对 Openwork 的启发：extension runtime 和 renderer surface 分开是合理的。runtime 可以拥有业务状态和 callback，renderer 只接收可显示数据并回传事件。

### Shopify Remote Rendering

技术博客：[Remote Rendering: UI Extensibility](https://shopify.engineering/remote-rendering-ui-extensibility)

开源实现：[remote-dom](https://github.com/Shopify/remote-dom)

Shopify 的 remote rendering 思路是让扩展侧描述 UI，宿主侧真正渲染 UI。这样可以避免第三方代码直接持有宿主 DOM，也能让宿主控制交互、安全和视觉一致性。

对 Openwork 的启发：custom React reconciler 生成 host tree / snapshot 是成立的。这个方向比把 extension React 直接渲染到 launcher renderer 更稳。

## SuperCmd 调研

本地参考仓库：`/Users/junjieding/dingjunjie_dev/2026_03/SuperCmd`

SuperCmd 的架构更像 Raycast compatibility shim。它的核心做法是：

1. 安装或构建阶段用 esbuild 编译 command；
2. 产物放到 `.sc-build/*.js`；
3. extension tarball 里包含 `package.json`、assets、`.sc-build` 和 metadata；
4. 业务依赖 bundle 进 command 产物；
5. `react`、`react-dom`、`@raycast/api`、`@raycast/utils`、Node builtins 等作为 external；
6. renderer 里用 fake `require` 和 `new Function` 执行 CJS bundle；
7. Raycast API 由 SuperCmd 自己的 shim 接住。

这个方案的优点是迁移 Raycast extension 很直接，构建产物也清晰：

```txt
extension package
  package.json
  assets/
  .sc-build/
    command.js
  .sc-meta.json
```

但它不应该成为 Openwork runtime 的主模型。原因是：

- extension code 在 renderer 中执行，隔离性弱；
- fake `require` 和 API shim 会把 renderer 变成巨大兼容层；
- extension callback、UI、宿主 API 容易混在一个执行上下文；
- runtime crash 和 UI crash 的边界不够清楚。

SuperCmd 对 Openwork 更有价值的是 build/package 策略，而不是 runtime 执行策略。

## 外部依赖和包构建策略

外部 extension 不应该默认把 `node_modules` 原样带进来。更合理的策略是：

```txt
extension source package
  -> package manager install deps
  -> build command bundles
  -> publish/install runtime artifact
```

运行产物建议形态：

```txt
openwork-extension.tgz
  manifest.json
  runtime/
    search-repositories.js
    create-issue.js
  main/
    tools.js
  runtime-metadata.json
  assets/
```

构建时依赖处理：

- extension 自己声明业务依赖，例如 `@notionhq/client`、`date-fns`；
- 业务依赖默认 bundle 进 command 或 main 产物；
- Openwork public SDK、React runtime、Node builtins、宿主 capability facade 由宿主 external；
- native addon、动态 require、postinstall 脚本依赖需要明确限制或单独审核；
- package install 阶段生成依赖报告和 unsupported API 报告。

这回答了“是不是可以 pkg 导入”的问题：可以把 extension 当 package 导入，但宿主不应该直接运行源码包里的任意结构。更稳的是定义 installable artifact contract，让 package 经过构建后只暴露 manifest、runtime entry、main entry、metadata 和 assets。

当前 Openwork 的 `docs/extension-package-contract.md` 已经定义了类似方向：

```txt
extension package
  -> manifest
  -> runtime entry
  -> main entry
  -> runtime metadata
  -> package assets
```

后续要补的是“外部安装包的构建产物格式”和“依赖 external/bundle 规则”，而不是推翻现有 package contract。

## Openwork 当前实现判断

### 正确的边界

当前关键实现锚点：

- `src/main/services/extension-runtime/utility-process-launcher.ts`：用 `utilityProcess.fork` 启动 runtime；
- `src/main/services/extension-runtime/runtime-manager.ts`：main 负责 runtime session 生命周期；
- `src/main/services/extension-runtime/host-capabilities.ts`：host capabilities 由 manifest 声明和校验；
- `src/extension-runtime/entry.ts`：runtime 侧解析 command 并执行 `run` 或渲染 `Component`；
- `src/extension-runtime/reconciler/render.ts`：custom reconciler 把 extension React tree 转成 host tree；
- `src/extension-runtime/reconciler/snapshot.ts`：host tree 转成 renderer 可消费 snapshot；
- `src/renderer/src/extension-runtime/RuntimeExtensionCommandSurface.tsx`：renderer 显示 snapshot 并回传事件。

这些边界符合成熟插件系统的共识：

```txt
extension owns state and callbacks
main owns lifecycle and capabilities
renderer owns presentation and user input forwarding
```

### 需要警惕的边界

当前需要重点检查的是 command 内部搜索是否被错误提升到了 route 层：

- `src/renderer/src/launcher-shell/hooks/launcher-router-store-core.ts` 的 `routeKey` 包含 `seedQuery`；
- `src/renderer/src/launcher-shell/LauncherCommandSurface.tsx` 的 extension command React `key` 包含 `route.seedQuery`；
- `src/renderer/src/extension-runtime/RuntimeExtensionCommandSurface.tsx` 启动 foreground runtime 的 effect 依赖包含 `host.seedQuery`；
- 该 effect cleanup 会 stop foreground runtime。

如果搜索输入导致 `seedQuery` 更新，那么每次输入都可能造成：

```txt
routeKey change
  -> page transition key change
  -> extension surface remount
  -> foreground runtime stop/start
  -> snapshot reset
  -> 看起来像页面刷新
```

这不是 Raycast 风格，也不是 remote rendering 风格。搜索 query 不应该成为 runtime launch identity。

## 搜索生命周期建议

建议把生命周期拆成四类数据：

```txt
route identity:
  extensionName
  commandName
  stable launch instance id
  stable launchProps

launch seed:
  seedQuery captured once when command opens

runtime state:
  searchText
  selected item
  filter values
  pagination
  loading state

runtime event:
  list.query.change
  action.execute
  dropdown.value.change
  form.field.change
```

搜索输入的理想路径：

```txt
user types
  -> renderer local input state changes
  -> renderer sends list.query.change to existing session
  -> runtime updates extension state through onSearchTextChange
  -> extension rerenders list snapshot
  -> renderer updates current surface without remount
```

不应该发生：

```txt
user types
  -> route key changes
  -> component key changes
  -> startForeground runs again
  -> old runtime session stops
  -> new runtime session starts
```

## 推荐修正方向

### 1. 保留 runtime 架构

不要把 extension React command 搬回 renderer，也不要走 SuperCmd 那种 renderer fake require 方案。Openwork 当前 `utilityProcess + RPC + snapshot` 的方向更符合长期架构。

### 2. 把 `seedQuery` 降级成 initial value

`seedQuery` 应该只在 command 打开时进入 runtime：

```txt
open command with seedQuery
  -> RuntimeExtensionCommandSurface captures initialSeedQuery
  -> runtime starts once
  -> later input changes do not mutate launch identity
```

实现上可以用 mount-time ref 或 explicit launch instance：

```txt
launch identity = extensionName + commandName + launchId
initial search = seedQuery
```

### 3. route key 不包含 command 内部 live search

如果 launcher shell 的全局搜索和 command 内部搜索共用输入框，需要定义所有权切换：

```txt
home/search page:
  input belongs to launcher search

inside extension command:
  input belongs to active command session
```

进入 extension command 后，输入不应该继续更新 home route 的 query。

### 4. `List.throttle` 需要语义落地

Openwork SDK 已经有 `List` 的 `throttle` prop 形态，但 renderer/runtime 事件侧需要确认是否真正实现了 Raycast 风格的节流语义。建议规则：

- `throttle={true}`：renderer 或 runtime bridge 对 `list.query.change` 做节流；
- `throttle={false}`：每次输入立即发送；
- extension 内部仍可用 `useDeferredValue` 或业务 debounce 做网络请求控制。

注意：节流只能减少网络或渲染压力，不能用来掩盖 session 被重启的问题。

### 5. 加行为验证

建议补一个小而稳的测试或调试断言：

```gherkin
Given a runtime-backed List command is open
When the user types three search characters
Then foreground runtime starts once
And the runtime session id stays the same
And three list.query.change events are delivered to that session
And the surface is not remounted
```

如果先不写 BDD，也至少加 dev trace：

```txt
startForeground
stopForeground
sessionId
routeKey
seedQuery
list.query.change
snapshot.revision
```

判断标准：

- 每次输入都有新 session：生命周期 bug；
- session 不变但列表 loading：extension 搜索行为正常，优化异步体验；
- session 不变但输入被覆盖：controlled `searchText` 同步 bug；
- session 不变但全页面动效重跑：renderer key 或 transition key bug。

## 实施顺序

建议按这个顺序做，不要一开始重构 package system：

1. 先验证搜索是否真的导致 `startForeground` 重跑；
2. 如果重跑，先移除 live `seedQuery` 对 route key、component key、foreground effect 的影响；
3. 补行为测试，锁住“搜索不重启 runtime session”；
4. 再补 `List.throttle` 语义；
5. 最后设计 external extension artifact contract 和 build pipeline。

这样改动半径最小，也最容易验证。

## 最终判断

Openwork 不应该复制 Raycast 的私有实现，也不应该复制 SuperCmd 的 renderer shim。更稳的方向是：

```txt
Raycast-like author API
VS Code/Theia-like runtime isolation
Figma/Shopify-like remote UI boundary
Electron utilityProcess as local process primitive
SuperCmd-like build artifact discipline
```

也就是说：

- API 可以像 Raycast；
- runtime 隔离应该更像 VS Code/Theia；
- UI 传输应该更像 remote rendering；
- 外部依赖可以借鉴 SuperCmd 的 bundle/external 规则；
- 搜索必须是 session 内部事件，不能是 route/launch identity。
