# Launcher Directory Map

这份文档只回答一件事：

`现在 launcher / ai / extension 到底放哪，先看哪几层。`

## 一句话

当前前端主线已经不再堆在 `src/renderer/src/launcher/**` 里了，而是拆成 5 块：

- `src/renderer/src/launcher-shell`
- `src/renderer/src/launcher-components`
- `src/renderer/src/extension-host`
- `src/renderer/src/ai-core`
其中这些目录里，`ai-core / extension-host / launcher-components / launcher-shell` 是当前主线。

## 先看这 8 个入口

1. [src/extensions/index.ts](/Users/junjieding/dingjunjie_dev/2026_03/openwork/src/extensions/index.ts)
2. [src/extensions/renderer.ts](/Users/junjieding/dingjunjie_dev/2026_03/openwork/src/extensions/renderer.ts)
3. [src/extensions/main.ts](/Users/junjieding/dingjunjie_dev/2026_03/openwork/src/extensions/main.ts)
4. [src/extensions/api.ts](/Users/junjieding/dingjunjie_dev/2026_03/openwork/src/extensions/api.ts)
5. [src/renderer/src/launcher-shell/LauncherApp.tsx](/Users/junjieding/dingjunjie_dev/2026_03/openwork/src/renderer/src/launcher-shell/LauncherApp.tsx)
6. [src/renderer/src/extension-host/index.ts](/Users/junjieding/dingjunjie_dev/2026_03/openwork/src/renderer/src/extension-host/index.ts)
7. [src/renderer/src/ai-core/command.ts](/Users/junjieding/dingjunjie_dev/2026_03/openwork/src/renderer/src/ai-core/command.ts)
8. [src/main/services/native-extensions/index.ts](/Users/junjieding/dingjunjie_dev/2026_03/openwork/src/main/services/native-extensions/index.ts)

如果只读这 8 个文件，就能看懂当前主线。

## 目录职责

### `src/extensions/*`

这是 extension 自己的地盘。

每个 extension 现在只认这几个文件：

- `manifest.ts`
- `renderer.ts`
- `main.ts`
- `src/<command>.tsx|ts`
- `src/<command>.meta.ts`

它负责：

- extension 是谁
- 有哪些 command
- command 对应哪个 renderer 文件
- 有没有 main service

它不负责：

- root search
- route
- shell chrome
- host context

### `src/renderer/src/launcher-shell/*`

这是 launcher 入口壳。

它负责：

- `LauncherApp`
- root search
- route
- home surface
- command 打开/返回
- launcher 窗口行为

它不负责：

- `List / Detail / Form`
- extension 自己的页面状态
- AI 线程逻辑

### `src/renderer/src/launcher-components/*`

这是 launcher / ai / extension 共用的壳层组件区。

现在主要是：

- `LauncherChrome`
- `LauncherSearchPage`
- `LauncherResultList`
- `LauncherHistoryGrid`
- `LauncherPageTransition`

判断标准：

`如果一个组件脱离具体 extension 仍然成立，它就可以在这里。`

### `src/renderer/src/extension-host/*`

这是 native extension runtime。

它负责：

- `NativeExtensionHost`
- `List / Detail / Form / MenuBarExtra`
- action runtime
- view stack
- passive command host
- extension host context

它不负责：

- launcher 根搜索
- AI 主控

### `src/renderer/src/ai-core/*`

这是 AI 自己的地盘。

现在已经放进来的有：

- `LauncherAiPage`
- `LauncherAiConversation`
- `useAiThread`
- `useAiAttachments`
- `history.tsx`  
  这是原 starter `Main` 页面，现在降级成 parked surface
- `AiCoreHost.tsx`
- `useAI.ts`
- `tool-registry.ts`
- `command.ts`

这里的原则是：

`AI 是平台原生能力，不再挂在 extension 或 launcher plugin 下面。`

## 当前目录总图

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
  renderer/src/
    ai-core/
    extension-host/
    launcher-components/
    launcher-shell/
    settings/
    shortcuts/
    lib/
    components/
  main/services/native-extensions/
```

## 一条真实链路

以 `github / my-issues` 为例：

1. [src/extensions/github/manifest.ts](/Users/junjieding/dingjunjie_dev/2026_03/openwork/src/extensions/github/manifest.ts)
   定义 extension 和 command 元信息。
2. [src/extensions/github/renderer.ts](/Users/junjieding/dingjunjie_dev/2026_03/openwork/src/extensions/github/renderer.ts)
   把 `my-issues` 映射到 renderer command module。
3. [src/extensions/renderer.ts](/Users/junjieding/dingjunjie_dev/2026_03/openwork/src/extensions/renderer.ts)
   把 `github` 收进全局 renderer registry。
4. [src/renderer/src/extension-host/index.ts](/Users/junjieding/dingjunjie_dev/2026_03/openwork/src/renderer/src/extension-host/index.ts)
   把 command 转成 launcher 可打开的 command owner。
5. [src/renderer/src/launcher-shell/pages/index.ts](/Users/junjieding/dingjunjie_dev/2026_03/openwork/src/renderer/src/launcher-shell/pages/index.ts)
   让 launcher shell 知道这个 command 可以被路由。
6. [src/renderer/src/launcher-shell/LauncherApp.tsx](/Users/junjieding/dingjunjie_dev/2026_03/openwork/src/renderer/src/launcher-shell/LauncherApp.tsx)
   在被打开时挂上 host，并渲染实际 command。

一句话收口：

`extensions 声明自己，extension-host 跑它，launcher-shell 打开它。`

## 现在先不要看的

如果你想先看主线，先不要把这些当核心：

- `docs/*` 里还没清完的历史路径引用
- `src/main/services/extensions/*`

它们不是当前 native extension 主线。

## 你要读代码时的顺序

建议就按这个顺序：

1. `src/extensions/github/manifest.ts`
2. `src/extensions/github/renderer.ts`
3. `src/extensions/api.ts`
4. `src/renderer/src/extension-host/index.ts`
5. `src/renderer/src/launcher-shell/pages/index.ts`
6. `src/renderer/src/launcher-shell/LauncherApp.tsx`
7. `src/renderer/src/ai-core/command.ts`
8. `src/renderer/src/ai-core/useAI.ts`

读完这 8 个点，当前目录就不会再是“看起来很多层都在互相引用”的感觉。
