# Launcher Extension Phase Checkpoints

这份文档只服务一件事：

`避免 launcher / native extension 架构改造跑偏。`

当前范围只包含 launcher 架构，不包含 starter 自带的 Main 页面重做。

## 当前总原则

1. `LauncherShell` 是入口壳，不是 extension runtime。
2. `AI` 是平台原生能力，不挂在 extension 下面。
3. `native extension` 先做干净，再谈外部 extension 兼容。
4. 只在仓库内分发，不为外部导入提前做复杂抽象。
5. 每个 pause 点都必须是完整、可验收、可停下来的状态。

## 相关架构文档

- [shortcut-system-architecture.md](/Users/junjieding/dingjunjie_dev/2026_03/openwork/docs/shortcut-system-architecture.md)
- [cleanups.md](/Users/junjieding/dingjunjie_dev/2026_03/openwork/docs/cleanups.md)

这份文档不是附属说明，而是 launcher 主线的平行基础设施文档。

原因很简单：

- root search、action panel、menu bar、settings 最终都要吃统一 command/shortcut 模型
- extension command 以后要能声明和展示快捷键，但不能自己私挂监听器
- launcher route 去 plugin 化之后，快捷键系统也必须跟着转成 `command-first`

所以后续凡是改：

- launcher route 语言
- command registry
- action runtime
- settings 中的 command 配置

都必须同时核对这份快捷键架构文档，而不是把快捷键留到最后补。

`cleanups.md` 则负责另一件事：

- 前几个 pause 为了不一次性炸掉而留下的桥接层，必须登记进去
- 后续 phase 完成时，相关桥接层必须被删除，而不是永久常驻
- 每个 pause 结束都要同时核对“新增了什么临时层”和“删掉了什么临时层”

## 非目标

- 现在不上 monorepo / workspace。
- 现在不做外部 extension 导入。
- 现在不为了“完整”把所有 Raycast 能力一次补齐。
- 现在不删除 starter 自带的 Main 页面。

## Main 页面策略

Main 页面先保留，但降级成 `parked surface`：

- 不新增能力
- 不参与 launcher / extension / ai-core 的架构前提
- 只能复用 `shared/*`
- 之后如果连续几个阶段都没再用，再删

## 目标架构形状

当前先不做目录大搬家，但逻辑边界必须先定死。

目标上只认 5 层：

1. `shared`
2. `launcher-shell`
3. `extension-host`
4. `extension-sdk`
5. `extensions/*`

再加一个独立内核：

6. `ai-core`

依赖方向只允许这样：

```txt
shared <- launcher-shell
shared <- extension-host
shared <- extension-sdk
shared <- ai-core

extension-sdk -> extension-host
extensions/* -> extension-sdk

launcher-shell -> extension-host
launcher-shell -> ai-core
```

不允许这样：

- `extensions/* -> launcher-shell`
- `extensions/* -> main/preload/renderer 私有实现`
- `extension-sdk -> launcher-shell`
- `ai-core -> extension runtime 私有实现`

## 当前路径到目标层的映射

现在不急着改目录名，但每个目录已经要按目标层理解。

### 1. launcher-shell

当前主要对应：

- `src/renderer/src/launcher/LauncherApp.tsx`
- `src/renderer/src/launcher/components/**`
- `src/renderer/src/launcher/hooks/**`
- `src/renderer/src/launcher/home-surface.ts`
- `src/renderer/src/launcher/search-items.ts`
- `src/renderer/src/launcher/pages/**`

职责：

- launcher 窗口入口
- root search
- home surface 组装
- route 切换
- shell chrome
- 键盘和窗口语义

不负责：

- `List / Detail / Form / MenuBarExtra`
- extension runtime state
- extension 作者 API

### 2. extension-host

当前主要对应：

- `src/renderer/src/launcher/native-extensions/**`
- `src/main/services/native-extensions/**`
- `src/main/preferences.ts` 里和 extension settings/secrets 直接相关的部分

职责：

- 加载 native extension command
- 运行 view / no-view / menu-bar / background command
- 管理 extension host context
- command preferences / extension preferences
- RPC / service bridge
- passive command 生命周期

不负责：

- root search 排序
- launcher 首页 section 组织
- AI 主控逻辑

### 3. extension-sdk

当前主要对应：

- `src/extensions/api.ts`

后续应逐步包含：

- `useAI`
- `compilerSkill`
- `registerMcp`
- `registerContextProvider`

职责：

- 给 extension 作者一个稳定入口
- 暴露 `List / Detail / Form / ActionPanel / MenuBarExtra`
- 暴露 navigation / preferences / clipboard / threads / AI 等宿主能力

不负责：

- 直接持有 launcher 组件
- 暴露 launcher 私有状态模型

### 4. extensions/*

当前主要对应：

- `src/extensions/todo-list/**`
- `src/extensions/github/**`
- `src/extensions/translate/**`

职责：

- 具体 extension 的 manifest
- command 实现
- extension 本地共享逻辑
- 可选 main service

不负责：

- 自己发明宿主 API
- 自己接 preload / main 私有桥
- 直接 import launcher 组件

### 5. ai-core

当前还没正式独立目录，但原则先定：

- AI 是平台内核
- extension 可以消费 AI，也可以向 AI 注册能力
- AI 不是 built-plugin 的同义词

## 文件放置规则

下面这张表是后面所有改动的落点规则。

### launcher-shell 里的文件该怎么放

`src/renderer/src/launcher/LauncherApp.tsx`

- 只放 launcher 窗口根组件
- 只编排 shell、route、host 接线
- 不写 extension surface 细节

`src/renderer/src/launcher/components/*`

- 只放 launcher 自己的壳层组件
- 例如 input、footer、search page、history grid
- 不能成为 extension SDK 的直接实现入口

`src/renderer/src/launcher/hooks/*`

- 只放 launcher 自己的状态和交互 hooks
- 例如 root search、router、clipboard preview
- extension 不应直接 import

`src/renderer/src/launcher/pages/*`

- 只放 launcher route 类型、built-in command 定义、route registry
- 这里后续应该只保留 built-in command 和 route 语义
- native extension 不该继续在这里伪装成 `internal-plugin`

`src/renderer/src/launcher/built-plugins/*`

- 临时区，只允许平台内建能力
- 当前主要是 AI
- 不允许再接新的 native extension

`src/renderer/src/launcher/external-runtime/*`

- 冻结区，未来兼容外部 Raycast extension 时再看
- 不参与当前 native extension 主线

### extension-host 里的文件该怎么放

`src/renderer/src/launcher/native-extensions/index.ts`

- 只做 native extension host 的 renderer 侧入口
- 不做 root search 组装

`src/renderer/src/launcher/native-extensions/registry.ts`

- 管理 native extension command registry
- 当前可以先显式化，不要继续长隐式发现

`src/renderer/src/launcher/native-extensions/sdk.ts`

- 放 native host 提供给 SDK 的桥
- Phase 2 后不应继续直接复用旧 `LauncherPlugin*`

`src/renderer/src/launcher/native-extensions/ui.tsx`

- `List / Section / Item / ActionPanel / Action`
- 这里只做 extension surface，不做 launcher 首页列表

`src/renderer/src/launcher/native-extensions/detail.tsx`

- `Detail` surface

`src/renderer/src/launcher/native-extensions/form.tsx`

- `Form` surface

`src/renderer/src/launcher/native-extensions/menu-bar.tsx`

- `MenuBarExtra` surface

`src/renderer/src/launcher/native-extensions/view-stack*.ts*`

- extension 内部 view stack
- 不处理 launcher root route

`src/main/services/native-extensions/index.ts`

- main 侧 native extension registry
- service module 发现和调用
- settings schema 汇总

`src/main/services/native-extensions/sdk.ts`

- main 侧给 extension service 用的最小 helper
- 不写 renderer 逻辑

`src/main/preferences.ts`

- 全局 settings 和 extension settings 的总入口
- 但 secrets 只是过渡态，后续要拆出专门边界

### extension-sdk 里的文件该怎么放

`src/extensions/api.ts`

- extension 作者唯一稳定入口
- 后续只允许从这里拿宿主能力
- 不允许 extension 直接 import `src/renderer/src/launcher/**`

如果未来 SDK 继续变大，再拆成：

- `src/extensions/api.ts`
- `src/extensions/sdk/*`

但现在先不提前拆。

### extension 包里的文件该怎么放

`src/extensions/<ext>/manifest.ts`

- extension 单一事实源
- 定义 id、title、commands、preferences、capabilities、rpcMethods

`src/extensions/<ext>/index.ts`

- 只做 command/service 注册
- 不写业务逻辑

`src/extensions/<ext>/src/<command>.tsx`

- view command 实现

`src/extensions/<ext>/src/<command>.ts`

- no-view command 实现

`src/extensions/<ext>/src/<command>.meta.ts`

- view command 的 title / viewport / search 等元信息
- 不和组件写在一个文件里

`src/extensions/<ext>/main/service.ts`

- 可选
- 只有需要 main 侧 RPC/service 时才放

`src/extensions/<ext>/src/*.ts`

- extension 自己的纯逻辑
- 比如 client、contracts、view helpers

## 共享代码放哪

只有“去掉宿主语义后仍成立”的东西，才能进 `shared/*`。

可以进 shared：

- 纯 types
- 纯 schema
- 纯函数
- 无 launcher 语义的 UI token
- 无宿主状态的 hooks / utils

不能进 shared：

- root search 语义
- launcher route 语义
- extension host context
- AI runtime 私有上下文

## 当前最重要的目录纪律

1. `src/extensions/*` 只能 import `src/extensions/api.ts` 和 `shared/*`
2. `src/extensions/*` 不再新增对 `LauncherPlugin*` 的依赖
3. `src/renderer/src/launcher/built-plugins/*` 不再承接新的 native extension
4. `src/renderer/src/launcher/external-runtime/*` 先冻结
5. `Main` 页面不参与当前架构前提
6. 快捷键绑定最终走统一 command/registry，不再允许页面各自长 `window.addEventListener("keydown")`

## 每次开始前后的固定动作

开始前：

```bash
npm run doctor:architecture
```

结束后：

```bash
npm run check:guardrails
npm run typecheck
```

如果某个阶段只动 extension contract 或 registry，至少跑：

```bash
npm run check:extension-contract
npm run check:extension-registry
```

## Phase 0

### 名称

冻结主线外 surface

### 目标

先把主线范围收紧，不让 Main 页面和其他临时 surface 继续影响 launcher 架构。

### 边界

- launcher 主线 = `src/renderer/src/launcher/**`
- native extension 主线 = `src/extensions/**` + `src/main/services/native-extensions/**`
- Main 页面不再作为任何新架构决策前提

### 暂停点验收

- 文档里明确写出 Main 页面是 parked surface
- 后续改动说明里不再把 Main 页面作为 blocker
- `doctor` / `guardrails` / `typecheck` 通过

## Phase 1

### 名称

路由语言去 plugin 化

### 目标

让 native extension 在 launcher 里先成为独立的 command 单元，而不是继续伪装成 `internal-plugin`。

### 只做什么

- 拆开 `built-in command` 和 `extension command` 的地址类型
- root search 的 `commandRef` 改成直接指向 command source
- native extension 内部 `openCommand()` 不再手写 `internal-plugin`

### 绝对不做什么

- 不改 `List / Detail / Form`
- 不改 settings UI
- 不改 preferences 存储
- 不碰外部 extension 兼容层

### 代码边界

- `src/renderer/src/launcher/pages/**`
- `src/renderer/src/launcher/hooks/useLauncherRouter.ts`
- `src/renderer/src/launcher/search-items.ts`
- `src/renderer/src/launcher/home-surface.ts`
- `src/extensions/github/**` 里少量 `openCommand()` 调用

### 暂停点验收

- 搜索和打开 `AI / Todo List / GitHub` 都正常
- `GitHub` 内部跳转不再写 `internal-plugin`
- `npm run doctor:route-language` 的 route 语言告警数量下降
- `npm run check:guardrails && npm run typecheck` 通过

## Phase 2

### 名称

NativeExtensionHost 脱离 LauncherPluginHost

### 目标

让 native extension runtime 不再直接复用旧 `LauncherPlugin*` 骨架。

### 只做什么

- 单独定义 `NativeExtensionHost` context/value
- `src/extensions/api.ts` 只暴露 native host 能力
- `native-extensions/sdk.ts` 不再直接 re-export `useBuiltLauncherPlugin*`

### 绝对不做什么

- 不顺手重写所有 command
- 不引入新的大而全通用抽象
- 不改 AI 页面

### 代码边界

- `src/renderer/src/launcher/native-extensions/**`
- `src/renderer/src/launcher/LauncherPluginHost*.ts*`
- `src/extensions/api.ts`

### 暂停点验收

- `src/extensions/**` 不再直接依赖旧 `LauncherPlugin*` 语义
- `todo-list`、`github/notifications`、`github/create-issue` 都还能跑
- `npm run check:no-legacy-plugin-coupling` 通过
- `npm run check:guardrails && npm run typecheck` 通过

## Phase 3

### 名称

显式 registry 替代隐式发现

### 目标

既然目前只在仓库内分发，就不用继续依赖 `glob + 字符串路径 + 隐式发现`。

### 只做什么

- 把 `src/extensions/index.ts` 收成显式 registry
- 把 native command registry 改成显式 import
- main / renderer 共用同一份 extension registry 信息

### 绝对不做什么

- 不提前做外部 extension loader
- 不上 workspace
- 不引入 codegen，除非显式 registry 已经明显过重

### 代码边界

- `src/extensions/index.ts`
- `src/extensions/*/index.ts`
- `src/renderer/src/launcher/native-extensions/registry.ts`
- `src/main/services/native-extensions/index.ts`

### 暂停点验收

- 新增一个 extension 时，修改点是可数的、显式的
- 仓库里不再新增 `import.meta.glob` 扩散发现逻辑
- `npm run check:extension-contract`
- `npm run check:extension-registry`
- `npm run check:no-glob-sprawl`
- `npm run typecheck`

## Phase 4

### 名称

shell contract 去 legacy plugin 语言

### 目标

让 `launcher-shell / built-in / native extension adapter` 这层不再把 `LauncherPlugin*` 当第一语言。

### 只做什么

- 把 `pages/**` 里的核心类型收成 `command owner / command definition`
- built-in AI 和 native extension adapter 不再以 `LauncherPluginDefinition` 为公开契约
- 把旧 `LauncherPlugin*` 语言往 host / 兼容边界里推，不再留在 shell 主路径

### 绝对不做什么

- 不改 secrets 存储
- 不重写 AI 页面
- 不改 `List / Detail / Form`
- 不搬目录

### 代码边界

- `src/renderer/src/launcher/pages/**`
- `src/renderer/src/launcher/built-plugins/**`
- `src/renderer/src/launcher/native-extensions/index.ts`
- `src/shared/native-extensions.ts`

### 暂停点验收

- `AI / Todo List / GitHub` 仍然能搜索、打开、跳转
- `pages/**`、`built-plugins/**`、`native-extensions/index.ts` 不再把 `LauncherPlugin*` 当公开主契约
- `npm run doctor:route-language` 告警数量明显下降
- `npm run check:guardrails && npm run typecheck` 通过

## Phase 5

### 名称

preferences / secrets 边界收口

### 目标

把“设置”和“密钥”分开，并让 active command 对设置变化可见。

### 只做什么

- `password` 类型不再走普通 settings 存储
- active view command 订阅 preference 变化
- settings -> command 的回流语义明确
- secrets 实现优先用 Electron 自带 `safeStorage` 和独立 secrets store，不为这一步引入更重的商业化依赖或权限系统

### 绝对不做什么

- 不把所有配置系统重写一遍
- 不提前做复杂权限系统

### 代码边界

- `src/main/preferences.ts`
- `src/main/services/native-extensions/**`
- `src/renderer/src/settings/**`
- `src/renderer/src/launcher/native-extensions/**`

### 暂停点验收

- GitHub token 不再按普通文本 preference 存储
- 在 settings 修改 GitHub token 后，已打开的 GitHub command 能刷新
- `npm run doctor:secrets-boundary` 告警收敛
- `npm run check:guardrails && npm run typecheck` 通过

## Phase 6

### 名称

surface controller 收口

### 目标

避免 `List / Detail / Form` 各自复制一套 footer / back / primary action 规则。

### 只做什么

- 抽统一的 surface controller
- back button、footer、主动作、`⌘K`、`↵` 语义统一

### 绝对不做什么

- 不顺手发明更多 UI surface
- 不碰根搜索模型

### 代码边界

- `src/renderer/src/launcher/native-extensions/ui.tsx`
- `src/renderer/src/launcher/native-extensions/detail.tsx`
- `src/renderer/src/launcher/native-extensions/form.tsx`
- `src/renderer/src/launcher/native-extensions/chrome.tsx`

### 暂停点验收

- `todo-list`、`github/notifications`、`github/create-issue` 的顶部/底部行为一致
- 改一个 footer 规则，不需要改三处
- `npm run check:guardrails && npm run typecheck` 通过

## Phase 7

### 名称

AI core contract 接入

### 目标

明确 `AI` 是平台原生能力，extension 只能消费或注册能力。

### 只做什么

- 定义最小 `useAI()` contract
- 定义 `compilerSkill`、`registerMcp`、`registerContextProvider` 的最小接口
- 不急着把全部实现打通

### 绝对不做什么

- 不把 AI 降成 extension
- 不把 extension runtime 和 AI runtime 混成一个上下文

### 代码边界

- `src/extensions/api.ts`
- 新的 `src/ai-core/**`
- 必要的 host bridge

### 暂停点验收

- extension 可以通过 SDK 看到 `useAI()` 的稳定接口
- AI 仍然是平台原生能力，不需要作为 extension 注册
- `npm run check:guardrails && npm run typecheck` 通过

## 下一步只做什么

下一步只进入 `Phase 6`。

也就是：

- 不加新 command
- 不碰 route / secrets / AI contract
- 只收口 `List / Detail / Form` 的统一 surface controller
- 把 back button、footer、主动作、`⌘K`、`↵` 的规则收成一套

做完就停，按 Phase 6 的验收口径过一遍。
