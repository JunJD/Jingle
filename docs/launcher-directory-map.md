# Launcher Directory Map

这份文档只回答一件事：

`现在 Openwork 的 launcher / native extension 目录，到底该怎么读。`

不是未来理想形态，不是所有文件逐个解释，而是当前阶段最稳定、最值得记住的目录地图。

## 一句话地图

现在主线只需要看 6 个入口：

1. `src/extensions/index.ts`
2. `src/extensions/renderer.ts`
3. `src/extensions/main.ts`
4. `src/extensions/api.ts`
5. `src/renderer/src/launcher/native-extensions/`
6. `src/main/services/native-extensions/index.ts`

如果这 6 个入口看懂了，当前 native extension 主线就看懂了。

## 先记住的分层

当前应按这 5 层来理解，不要再按旧的 `plugin` 语言理解：

- `shared`
  - 共享类型、共享契约、共享转换函数
- `extensions`
  - extension 的声明域
- `launcher-shell`
  - launcher 入口壳、根搜索、路由
- `extension-host`
  - native extension 运行时
- `main services`
  - extension 在 main 进程的 service / settings / invoke

一句话：

`extensions 负责声明自己，launcher-shell 负责打开命令，extension-host 负责把命令跑起来，main services 负责主进程能力。`

## 目录总图

```txt
src/
  shared/
  extensions/
    api.ts
    index.ts
    renderer.ts
    main.ts
    github/
    todo-list/
    translate/
  renderer/src/launcher/
    pages/
    native-extensions/
    built-ins/
    components/
    hooks/
  main/services/native-extensions/
```

## 你现在该先看哪 6 个文件

### 1. `src/extensions/index.ts`

作用：

- native extension 的 `manifest` 总表
- 这里只回答“系统里有哪些 extension”

不要在这里做：

- command 组件映射
- main service 映射
- 运行时逻辑

它是：

`extension 名单`

### 2. `src/extensions/renderer.ts`

作用：

- native extension 的 renderer 总表
- 把每个 extension 的 `renderer.ts` 收进来

它负责：

- `extension -> renderer definition`

它不负责：

- main service
- 根搜索
- settings 存储

它是：

`renderer 侧的 extension inventory`

### 3. `src/extensions/main.ts`

作用：

- native extension 的 main 总表
- 把每个 extension 的 `main.ts` 收进来

它负责：

- `extension -> main definition`

它是：

`main 侧的 extension inventory`

### 4. `src/extensions/api.ts`

作用：

- extension 作者唯一应该 import 的公开 API
- 暴露 `List / Detail / Form / MenuBarExtra / ActionPanel / hooks`

它是：

`extension sdk 入口`

对 extension 作者来说，最重要的一条规则是：

`src/extensions/*` 里的命令实现，应该优先只 import 这里和 shared。`

### 5. `src/renderer/src/launcher/native-extensions/`

作用：

- native extension renderer host
- 真正把 `List / Detail / Form / MenuBarExtra` 跑起来

这个目录可以再拆成 4 类：

- `index.ts`
  - 把 `src/extensions/renderer.ts` 变成 launcher 可打开的命令定义
- `NativeExtensionHost.tsx`
  - host context
- `sdk.ts`
  - runtime hooks 的实现
- `ui.tsx / detail.tsx / form.tsx / menu-bar.tsx`
  - native surface runtime
- `surface-actions.tsx / chrome.tsx`
  - surface 共享控制层

它是：

`renderer 里的 extension runtime`

### 6. `src/main/services/native-extensions/index.ts`

作用：

- 把 `src/extensions/main.ts` 变成 main 进程可调用的 service
- 负责 settings schema、RPC invoke、main-side service 校验

它是：

`main 里的 extension runtime entry`

## 一个 extension 自己的目录应该怎么看

以 `github` 为例：

```txt
src/extensions/github/
  manifest.ts
  renderer.ts
  main.ts
  src/
    my-issues.tsx
    my-issues.meta.ts
    create-issue.tsx
    notifications.tsx
```

### `manifest.ts`

作用：

- extension 元信息
- commands
- preferences
- capabilities

它回答：

- 这是什么 extension
- 它有哪些 command
- 它需要哪些设置

### `renderer.ts`

作用：

- 显式声明这个 extension 的 renderer commands

它回答：

- 哪个 command 对应哪个组件
- 哪个 command 对应哪个 `.meta.ts`

### `main.ts`

作用：

- 显式声明这个 extension 的 main service

它回答：

- 这个 extension 有没有 main-side service
- 有的话，暴露哪些 methods

### `src/*.tsx`

作用：

- 真正的 command 实现

### `src/*.meta.ts`

作用：

- view command 的 `viewport / search` 元信息

## 现在最容易让人混乱的目录

下面这些目录不是“当前 native extension 主线”，要分开看。

### `src/renderer/src/launcher/pages/`

它是：

- launcher shell 的 route / command 打开协议

它不是：

- extension 作者写页面的地方

可以理解成：

`launcher 怎么决定打开哪个 command`

### `src/renderer/src/launcher/components/`

它是：

- launcher 自己的壳组件
- 根搜索、首页展示、输入框等

它不是：

- extension sdk

不要把这里和 `src/extensions/api.ts` 混在一起看。

### `src/renderer/src/launcher/built-ins/`

它是：

- 内建命令的 host 适配层

可以暂时理解成：

`给 launcher 自己的原生命令用的，不是 extension 作者关心的目录`

### `src/renderer/src/launcher/built-plugins/`

它现在是：

- 旧骨架残留区
- 主要给 AI / 少量 built-in 命令做过渡

它不是：

- native extension 新主线

所以现在看目录时，可以把它当：

`过渡层`

### `src/renderer/src/launcher/external-runtime/`

它现在是：

- 冻结的兼容区
- 给外部 Raycast/SuperCmd 兼容实验留下的历史层

它不是：

- 当前 native extension 主线

可以直接理解成：

`compat zone，先别看`

### `src/shared/launcher-plugin.ts`

它现在是：

- legacy contract
- cleanup 候选

它仍然存在，是因为还没到 final cleanup，不代表它还是你应该围绕构建的新中心。

## 真正的主线路径

当前一条 native extension command 的主路径是：

```txt
src/extensions/<id>/manifest.ts
  -> src/extensions/renderer.ts
  -> src/renderer/src/launcher/native-extensions/index.ts
  -> src/renderer/src/launcher/pages/index.ts
  -> src/renderer/src/launcher/LauncherApp.tsx
  -> src/renderer/src/launcher/native-extensions/NativeExtensionHost.tsx
  -> src/extensions/api.ts
  -> src/extensions/<id>/src/<command>.tsx
```

如果这个 command 还需要 main service：

```txt
src/extensions/<id>/main.ts
  -> src/extensions/main.ts
  -> src/main/services/native-extensions/index.ts
  -> preload / ipc
  -> renderer sdk client
```

这两条线一起看，就不会再把目录看散。

## 现在该怎么记

如果你只想有一个最小脑图，就记下面这 4 句：

- `src/extensions/*` 是 extension 自己的地盘
- `src/extensions/api.ts` 是作者 API 入口
- `src/renderer/src/launcher/native-extensions/*` 是 extension runtime
- `src/main/services/native-extensions/index.ts` 是 main service runtime

其他 launcher 目录，先按下面分类看：

- `pages / components / hooks`
  - launcher-shell
- `built-ins / built-plugins`
  - 过渡或内建
- `external-runtime`
  - 冻结 compat zone

## 当前还不够干净的地方

你感觉目录还不够一眼清楚，是对的。现在还剩 3 个没完全收干净的点：

1. `built-plugins/` 这个名字还在污染认知
2. `LauncherPlugin*` 语言还在少量 host 文件里残留
3. AI 还没进 `ai-core`，所以你会觉得“主线已经是 extension 了，但 AI 还像另一套”

这也是为什么后面还有：

- `Phase 8: AI core contract`
- `Final Cleanup`

所以现在的准确判断不是“目录已经终局很干净”，而是：

`主线已经能读了，但过渡层还没删完。`

## 推荐阅读顺序

如果你要自己读代码，推荐只按这个顺序：

1. `src/extensions/index.ts`
2. `src/extensions/api.ts`
3. `src/extensions/github/manifest.ts`
4. `src/extensions/github/renderer.ts`
5. `src/extensions/github/main.ts`
6. `src/renderer/src/launcher/native-extensions/index.ts`
7. `src/renderer/src/launcher/native-extensions/NativeExtensionHost.tsx`
8. `src/main/services/native-extensions/index.ts`

只读这 8 个入口，不要一开始就钻进 `components/`、`hooks/`、`external-runtime/`。

## 最后一句话

现在这套目录，不该再理解成：

`launcher 下面挂很多 plugin 页面`

而应该理解成：

`launcher-shell 打开 command，extension 在自己的目录里声明自己，native extension host 负责运行它。`
