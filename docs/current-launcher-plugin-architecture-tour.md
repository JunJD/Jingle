# Current Launcher Plugin Architecture Tour

## 这一层现在到底是什么

一句话：

`Openwork 现在有的是一个 first-party launcher plugin host，不是完整 extension platform。`

## 当前推进原则

这一条对后续判断很重要：

`这个项目还没有上线，所以我们完全可以为了更清晰、更优秀的架构主动重构，不需要背历史兼容包袱。`

这意味着：

- 不需要为了旧 authoring path 长期保留双轨制
- 不需要为了“也许以后会有人依赖”而继续容忍边界混乱
- 可以优先选择结构更干净、单一事实源更强的方案

但推进方式要克制：

- 一次只推进一个边界
- 每一步先拉齐认知，再动实现
- 每一步结束都要能回答“现在是否比之前更清楚”

更具体一点：

- 共享层定义了 `manifest contract`
- renderer 层定义了 `plugin entry runtime`
- main 层定义了 `optional rpc service`
- shell 层按 capability 把 host 能力注进插件

所以当前插件机制的真实结构是：

`manifest -> renderer entry registry -> host injection -> optional main RPC`

它已经不是“随便挂一个页面”，但也还不是 Raycast 那种完整 `extension package`。

## 1. `manifest` 负责什么

入口文件：

- [src/shared/launcher-plugin.ts](/Users/junjieding/dingjunjie_dev/2026_03/openwork/src/shared/launcher-plugin.ts)

这层定义了当前插件 contract：

- `id`
- `displayName`
- `runtime`
- `entries`
- `defaultEntryId`
- `capabilities`
- `rpcMethods?`
- `clipboard?`

它当前解决的是三件事：

1. 插件叫什么、有哪些 entry
2. 插件声明了哪些 capability
3. 如果要走 main-side RPC，方法名必须提前声明

启动期校验已经有了：

- entry 去重
- default entry 必须存在
- rpc method 去重
- 声明了 rpcMethods 就必须有 `rpc` capability
- 声明了 clipboard filter 就必须有 `clipboard` capability

所以这层已经不是摆设，而是真正的边界声明层。

## 2. `pages/types.ts` 负责把 manifest 投影成 launcher 运行时概念

入口文件：

- [src/renderer/src/launcher/pages/types.ts](/Users/junjieding/dingjunjie_dev/2026_03/openwork/src/renderer/src/launcher/pages/types.ts)

这一层做的事是：

- 把 shared manifest 映射成 renderer 内部类型
- 定义 route 形状
- 定义 entry address
- 定义 intent / command match / open options

这里一个关键进步已经发生了：

route 不再只是 `pluginId`，而是：

`pluginId + entryId + initialAction + seedQuery`

这说明当前机制已经不是“一个插件一个页面”，而是：

`一个插件可以有多个 entry`

这是现有架构里最值得保住的点之一。

## 3. `defineBuiltLauncherPlugin()` 负责什么

入口文件：

- [src/renderer/src/launcher/built-plugins/sdk.ts](/Users/junjieding/dingjunjie_dev/2026_03/openwork/src/renderer/src/launcher/built-plugins/sdk.ts)

这是当前插件 authoring 的核心收口点。

插件作者现在实际在做的不是直接往 registry 里塞对象，而是：

- 提供 `manifest`
- 提供 `entries[]`
- 每个 entry 提供：
  - `Component`
  - `entryId`
  - `search.buildIntentItems?`
  - `search.resolveCommand?`
  - `viewport`

然后由 `defineBuiltLauncherPlugin()` 做两层校验：

1. manifest 本身合法
2. renderer entries 和 manifest entries 一一对应

这层的价值很高，因为它把“插件作者写的页面代码”收口成了可校验的 renderer contract。

## 4. renderer registry 现在怎么工作

入口文件：

- [src/renderer/src/launcher/built-plugins/index.ts](/Users/junjieding/dingjunjie_dev/2026_03/openwork/src/renderer/src/launcher/built-plugins/index.ts)
- [src/renderer/src/launcher/pages/index.ts](/Users/junjieding/dingjunjie_dev/2026_03/openwork/src/renderer/src/launcher/pages/index.ts)

现状很简单：

- `built-plugins/index.ts` 收集 first-party plugins
- `pages/index.ts` 把它们建成两个 map：
  - `pluginId -> plugin`
  - `pluginId:entryId -> entry`

然后 shell 通过它做：

- 默认 home entry 解析
- entry 查找
- search intents 汇总
- command resolution

所以今天 renderer registry 的职责其实已经比较清晰：

- 它不是做业务
- 它是在做 `entry discovery + routing + search integration`

## 5. host 是怎么注入的

入口文件：

- [src/renderer/src/launcher/LauncherPluginHost.ts](/Users/junjieding/dingjunjie_dev/2026_03/openwork/src/renderer/src/launcher/LauncherPluginHost.ts)
- [src/renderer/src/launcher/LauncherApp.tsx](/Users/junjieding/dingjunjie_dev/2026_03/openwork/src/renderer/src/launcher/LauncherApp.tsx)

这是当前机制里最像 Raycast 的一层。

### `LauncherPluginHost.ts`

它定义了插件在 renderer 里能拿到的 host value：

- `pluginId`
- `entryId`
- `seedQuery`
- `initialAction`
- `capabilities`
- `navigation?`
- `clipboard?`
- `surface?`
- `threads?`

并且每个 hook 都会做 capability gate：

- `useLauncherPluginClipboard()`
- `useLauncherPluginNavigation()`
- `useLauncherPluginSurface()`
- `useLauncherPluginThreads()`

如果插件没声明 capability，就会直接报错。

### `LauncherApp.tsx`

真正把 host 注进去的是 shell。

它会读取 active plugin manifest 的 `capabilities`，然后按 capability 条件组装 host：

- 有 `clipboard` 才注 clipboard
- 有 `navigation` 才注 navigation
- 有 `surface` 才注 surface
- 有 `threads` 才注 threads

这意味着现在的 host 不是全局大对象，而是：

`manifest 声明 -> shell 按声明注入 -> hook 按声明读取`

这是当前架构里最成熟的一段。

## 6. main-side RPC 现在怎么走

入口文件：

- [src/shared/built-plugins/sdk.ts](/Users/junjieding/dingjunjie_dev/2026_03/openwork/src/shared/built-plugins/sdk.ts)
- [src/preload/index.ts](/Users/junjieding/dingjunjie_dev/2026_03/openwork/src/preload/index.ts)
- [src/main/ipc/built-plugins.ts](/Users/junjieding/dingjunjie_dev/2026_03/openwork/src/main/ipc/built-plugins.ts)
- [src/main/services/built-plugins/sdk.ts](/Users/junjieding/dingjunjie_dev/2026_03/openwork/src/main/services/built-plugins/sdk.ts)
- [src/main/services/built-plugins/index.ts](/Users/junjieding/dingjunjie_dev/2026_03/openwork/src/main/services/built-plugins/index.ts)

当前 RPC 链路是：

`renderer client -> preload api.builtPlugins.invoke -> ipc builtPlugins:invoke -> main service.invoke()`

共享 request 结构很薄：

- `pluginId`
- `method`
- `payload`

但这条链已经有了 manifest 对齐校验：

- manifest 声明了 `rpcMethods`
- main service 必须实现完全同名的方法
- 没声明 `rpc` capability 却暴露 service 会启动报错

这说明当前 RPC 还不算丰富，但至少已经是“可审计 contract”，不是随意散调用。

## 7. 现在插件作者实际在写什么

看两个例子最清楚：

- [src/plugins/ai/manifest.ts](/Users/junjieding/dingjunjie_dev/2026_03/openwork/src/plugins/ai/manifest.ts)
- [src/plugins/translate/manifest.ts](/Users/junjieding/dingjunjie_dev/2026_03/openwork/src/plugins/translate/manifest.ts)
- [src/renderer/src/launcher/built-plugins/ai/index.ts](/Users/junjieding/dingjunjie_dev/2026_03/openwork/src/renderer/src/launcher/built-plugins/ai/index.ts)
- [src/renderer/src/launcher/built-plugins/translate/index.ts](/Users/junjieding/dingjunjie_dev/2026_03/openwork/src/renderer/src/launcher/built-plugins/translate/index.ts)

### `ai`

`ai` 当前是：

- 一个 manifest
- 一个 entry
- search intent builder
- 一个页面组件
- 不走 main RPC

### `translate`

`translate` 当前是：

- 一个 manifest
- 一个 entry
- search intent builder
- command resolver
- 一个页面组件
- 一个 main-side RPC service

所以现在的 authoring model 已经不是“写页面就完了”，而是：

`manifest + renderer entry + optional main service`

## 8. 这套架构已经做对了什么

### 1. manifest 已经是半个事实源

不是完美单一事实源，但已经比“几份平行配置”好很多。

### 2. entry 已经是一级概念

这很重要。它说明你们已经脱离“plugin = page”最糟糕的阶段。

### 3. capability gate 已经成立

这不是未来设想，是今天代码里已经生效的现实。

### 4. renderer / main 都已经有校验

不是纯运行时碰运气。

## 9. 这套架构现在最核心的问题是什么

不是“没有插件机制”，而是：

`它还是 launcher plugin architecture，不是 extension architecture。`

具体表现为：

### 1. `entry` 仍然是 human-facing page entry

虽然有 entry 概念，但它还不能表达：

- `no-view`
- `menu-bar`
- `assistant-tool`
- `background-job`

### 2. host capability 还只覆盖 launcher 页面世界

今天有：

- navigation
- clipboard
- surface
- rpc
- threads

但还没有：

- preferences
- storage
- supportPath
- cache
- secrets
- workspace

### 3. RPC contract 还太薄

现在只有：

`pluginId + method + payload`

这够当前 first-party plugin 用，但还不够做 extension platform。

### 4. assistant 没有进入同一个 contract

当前 assistant runtime 和 launcher plugin runtime 还是两层。

所以现在这套东西最好把它叫：

`launcher plugin host`

不要过早把它叫完整 `extension system`。

## 10. 这一步你该记住的结论

如果要压成最少的话，就是这 5 句：

1. 你们现在已经不是“没有插件机制”，而是已经有一个像样的 first-party launcher plugin host。
2. 当前最稳的边界是：`manifest -> entry -> host capability -> optional main RPC`。
3. 当前最成熟的地方不是页面，而是 `capability-gated host` 和 `manifest/rpc 对齐校验`。
4. 当前最大的缺口不是再加页面，而是把这套东西升级成 `extension contract`。
5. 所以下一步不该直接发明大平台，而该沿着现有骨架，小步把 `entry taxonomy` 和 `substrate` 补上。

## 一张最短结构图

```text
shared
  launcher-plugin.ts
    -> 定义 manifest contract

renderer
  built-plugins/*/index.ts
    -> 用 manifest + entries 定义插件
  pages/index.ts
    -> 建 registry 和 entry lookup
  LauncherApp.tsx
    -> 按 manifest capabilities 注入 host
  LauncherPluginHost.ts
    -> 插件通过 hooks 读取受限 host 能力

main
  services/built-plugins/index.ts
    -> 注册 manifest + optional service
  services/built-plugins/sdk.ts
    -> main-side method dispatch
  ipc/built-plugins.ts
    -> 暴露 invoke IPC

result
  当前成立的是 launcher plugin host
  还没有成立的是完整 extension platform
```
