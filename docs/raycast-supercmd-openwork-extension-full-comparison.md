# Raycast / SuperCmd / Openwork Extension 全量对照

## 结论先行

一句话：

- `Raycast` 是完整的 `extension-first platform`
- `SuperCmd` 是高完成度的 `Raycast command-extension compatibility layer`
- `Openwork` 现在还是 `launcher plugin host + assistant runtime`，还没形成完整 extension platform

再压缩一点：

- 如果问题是“SuperCmd 是不是完美复刻了 Raycast”，答案是 `不是`
- 如果问题是“它是不是认真复刻了 Raycast 的 extension command 机制”，答案是 `是，而且做得很深`
- 如果问题是“它连 Raycast 的 extension platform + AI tool platform 一起复刻了吗”，答案是 `没有`

## 评分视角

这不是产品总分，只是 `extension 平台完成度` 视角。

| 维度 | Raycast | SuperCmd | Openwork |
| --- | --- | --- | --- |
| `launcher / command` 平台 | `10/10` | `8.5/10` | `6.5/10` |
| `extension` 平台 | `10/10` | `6.5/10` | `3.5/10` |
| `AI tools` 并入 extension | `10/10` | `2/10` | `2/10` |
| `assistant / agent control plane` | `4/10` | `3/10` | `7/10` 方向上潜力更强 |

最重要的判断不是分数，而是三者的“最高抽象”不同：

- `Raycast` 的最高抽象是 `extension package`
- `SuperCmd` 的最高抽象是 `兼容运行 Raycast extension command`
- `Openwork` 想去的最高抽象是 `assistant-core 消费 extension / skill / tool`

## 全量对照表

| 主题 | Raycast | SuperCmd | Openwork | 判断 |
| --- | --- | --- | --- | --- |
| 平台主语义 | `extension-first` | `compatibility-first`，更像 `Raycast runtime clone` | 文档目标是 `assistant-first`，实现还停在 `launcher plugin` | 三者不是同一层竞争 |
| 最小平台单元 | `extension package` | `extension package`，但主要消费其 `commands[]` | 现在是 `launcher plugin`，目标才是 `extension` | Openwork 还没把 extension 立起来 |
| manifest 地位 | 强单一事实源 | 已经很重要，但仍偏向兼容消费 `package.json` | `LauncherPluginManifest` 存在，但还不是完整 extension manifest | Raycast 最完整 |
| human entry | `commands[]` | 解析并运行 `commands[]` | 有 `entries[]`，但还是 launcher page 语义 | SuperCmd 在这一层最像 Raycast |
| AI entry | `tools[]` | 基本没真正接上 | 还没正式成立 | 这是 SuperCmd 和 Openwork共同缺口 |
| 页面模式 | `view / no-view / menu-bar` | 已实现 | 现阶段更像 `internal-react page` | Openwork 还没统一 lifecycle taxonomy |
| background refresh | manifest `interval` | 已实现 | 还没形成统一 entry lifecycle | SuperCmd 已接近 Raycast |
| preferences | extension / command 级 schema | 已解析并接入设置页 | 只有零散设置，不是 extension substrate | Openwork 明显落后 |
| storage / cache / supportPath | 官方一等能力 | 已做 `LocalStorage / Cache / supportPath` 兼容面 | 还没有 extension 级 substrate | SuperCmd 已补到平台层 |
| SDK | `@raycast/api` + `@raycast/utils` | 大型 shim | 没有 extension SDK，只有 plugin host / RPC | SuperCmd 是兼容 SDK，不是自有平台 SDK |
| UI runtime | Raycast 原生宿主 UI | React + shim runtime 模拟 | launcher 内部 React host | SuperCmd 复刻的是 API 形状，不是原生 runtime |
| Action runtime | 原生 ActionPanel / shortcuts / list actions | 已做大量兼容 runtime | 只有很薄的 action 模型 | Openwork 还没把 action 变平台原语 |
| Menu Bar | 原生一等 surface | 已实现 | 还没有统一 surface taxonomy | SuperCmd 接近 |
| Script Commands | 官方独立体系 | 已支持 | 无对应成熟体系 | SuperCmd 接近 |
| Quicklinks | 官方一等对象 | 已支持 | 还没有对等平台对象 | SuperCmd 接近 |
| 扩展商店 / 分发 | Store / Teams / CLI / publish | 自建 catalog + backend + S3 bundle | 还没有 | SuperCmd 做了“替代性分发”，不是 Raycast 原厂分发 |
| 扩展安装流 | 官方 CLI / Store | API bundle + raw download + sparse git fallback | 没有 | SuperCmd 很强 |
| OAuth | 官方能力 | 已做较完整兼容 | 没有 | SuperCmd 接近 |
| Browser Extension bridge | 官方能力 | 还是 stub | 没有 | 两者都没追上 Raycast |
| cross-extension 调用 | 官方支持 | 仍不完整 | 没有 | 这里是明显平台缺口 |
| runtime isolation | 宿主原生控制 | renderer 执行 + fakeRequire + 很多 stub | first-party host，尚无外部 runtime isolation | 都没真正等价复制 Raycast |
| Node / native 依赖处理 | 宿主统一承担 | 大量 shim / external / stub | 还没进入这层 | SuperCmd 做的是兼容工程，不是真宿主等价 |
| AI.ask | 官方 AI API | 做了 app-level `AI.ask` | assistant 自己有 runtime，不是 extension API | SuperCmd 有 AI，但不是 extension tools 平台 |
| assistant / agent 集成 | AI 消费 extension tools | 以 AI app 能力为主，不是 extension orchestration | 文档目标就是 `assistant-core orchestrates extensions` | Openwork 方向最不同 |
| outputs / approvals / checkpoints / cleanups | 基本不是平台主轴 | 基本没有 | 明确要做成平台原语 | 这是 Openwork 真正该超的地方 |
| 外部作者心智 | 写 Raycast extension | 写 Raycast extension，尽量不改代码 | 目前只能写内部 plugin / skill | Openwork 还没开放作者模型 |

## Raycast 本质是什么

Raycast 的关键不是“启动器 UI 做得好”，而是它把这些东西收成了同一个平台：

- `package.json manifest`
- `commands[]`
- `tools[]`
- `preferences`
- `@raycast/api`
- Store / publish / distribution

所以它不是：

- 一个 launcher
- 再加一个 AI chat
- 再加一个 extension system

它更像：

`一个 extension package，同时面向 human surfaces 和 AI surfaces 暴露 entry`

本地 case 锚点：

- 示例 `todo-list` 同时声明了 `commands` 和 `tools`，见 [raycast/examples/todo-list/package.json](/Users/junjieding/dingjunjie_dev/2026_03/openwork/raycast/examples/todo-list/package.json)
- 真实商店里的 `todoist` 只有 `commands`，见 [raycast/extensions/todoist/package.json](/Users/junjieding/dingjunjie_dev/2026_03/openwork/raycast/extensions/todoist/package.json)
- `apple-reminders` 既有 `commands` 也有 `tools`，见 [raycast/extensions/apple-reminders/package.json](/Users/junjieding/dingjunjie_dev/2026_03/openwork/raycast/extensions/apple-reminders/package.json)

这就是为什么我前面一直说：`Raycast 是 extension-first，不是 AI-first。AI 只是 extension package 的上层消费面。`

## SuperCmd 到底复刻了什么

### 1. 它真的复刻了 extension command runtime

这不是 marketing 口号，代码上是成立的。

它自己把目标写成：

- 无改动兼容 Raycast extensions
- 跟踪 `@raycast/api` 的 API parity

见 [CLAUDE.md](/Users/junjieding/dingjunjie_dev/2026_03/SuperCmd/CLAUDE.md#L5)

具体做法：

- 读取 extension `package.json`
- 扫描 `commands[]`
- 解析 `mode / interval / preferences / arguments`
- 用 esbuild 预构建每个 command
- 在 renderer 里用 `fakeRequire` 注入 React、`@raycast/api`、`@raycast/utils`、Node shim

关键代码：

- command discovery: [src/main/extension-runner.ts](/Users/junjieding/dingjunjie_dev/2026_03/SuperCmd/src/main/extension-runner.ts#L281)
- build external rules: [src/main/extension-runner.ts](/Users/junjieding/dingjunjie_dev/2026_03/SuperCmd/src/main/extension-runner.ts#L659)
- runtime require shim: [src/renderer/src/ExtensionView.tsx](/Users/junjieding/dingjunjie_dev/2026_03/SuperCmd/src/renderer/src/ExtensionView.tsx#L3132)

### 2. 它也复刻了不少平台配套

不是只有 command runner。

它还补了：

- preferences schema
- `LocalStorage / Cache / supportPath`
- menu-bar lifecycle
- background refresh
- script commands
- quicklinks
- extension catalog / install / update / uninstall
- backend + S3 预构建 bundle 分发

安装分发链路见 [docs/extension-install-flow.md](/Users/junjieding/dingjunjie_dev/2026_03/SuperCmd/docs/extension-install-flow.md#L1)

这说明它不是简单“照着 Raycast 画个壳”，而是在做一个真正可运行的兼容平台。

## SuperCmd 没复刻到哪里

### 1. `tools[]` 没有真正成立

这是最大的断点。

我在当前实现里能看到：

- `commands[]` 被发现和执行
- `Tool.Confirmation` 只有类型声明

但没有看到：

- `pkg.tools` 的发现与注册
- tool 的执行入口
- AI 对 extension tools 的统一消费路径

证据：

- command discovery 明确只遍历 `pkg.commands`，见 [src/main/extension-runner.ts](/Users/junjieding/dingjunjie_dev/2026_03/SuperCmd/src/main/extension-runner.ts#L296)
- `Tool.Confirmation` 只是 type，见 [src/renderer/src/raycast-api/platform-runtime.ts](/Users/junjieding/dingjunjie_dev/2026_03/SuperCmd/src/renderer/src/raycast-api/platform-runtime.ts#L111)

所以更准确地说：

`SuperCmd 复刻了 Raycast 的 command extension 体系，没有完整复刻 Raycast 的 AI tool extension 体系。`

### 2. Browser Extension bridge 还是 stub

`BrowserExtension.getContent()` 和 `getTabs()` 现在直接返回空值并打印告警，见 [src/renderer/src/raycast-api/platform-runtime.ts](/Users/junjieding/dingjunjie_dev/2026_03/SuperCmd/src/renderer/src/raycast-api/platform-runtime.ts#L100)

这意味着依赖浏览器桥的 extension 不会真正等价运行。

### 3. cross-extension launch / permission 还不完整

renderer 明确写了跨 extension launch 需要权限处理但还是 TODO，见 [src/renderer/src/raycast-api/index.tsx](/Users/junjieding/dingjunjie_dev/2026_03/SuperCmd/src/renderer/src/raycast-api/index.tsx#L1831)

main 进程还明确写着：

- 不带 `extensionName` 的 `launchCommand`
- 也就是更自然的 intra-extension launch
- 目前“还没完全支持”

见 [src/main/main.ts](/Users/junjieding/dingjunjie_dev/2026_03/SuperCmd/src/main/main.ts#L11228)

### 4. 它是兼容 runtime，不是 Raycast 的宿主等价实现

很多事情它是靠这些手段扛住的：

- fakeRequire
- Node builtin stubs
- native addon stubs
- renderer 侧文件系统桥

这很厉害，但也说明它不是“原样复制 Raycast 宿主”，而是“构造了一个够用的兼容层”。

这会在这几类 extension 上更容易露出边：

- 深度依赖真实 Node / 原生模块的
- 深度依赖 BrowserExtension 的
- 深度依赖 cross-extension / permission 语义的

## Openwork 现在在哪

Openwork 现状不是 Raycast，也不是 SuperCmd。

它的已实现层更像：

- 有一个内部 first-party `launcher plugin host`
- 有一套独立存在的 `assistant runtime`
- 正在尝试把两者收束成 `assistant-core + extensions`

当前已有骨架：

- 共享 launcher plugin manifest，见 [src/shared/launcher-plugin.ts](/Users/junjieding/dingjunjie_dev/2026_03/openwork/src/shared/launcher-plugin.ts)
- host/runtime 改造方向，见 [docs/launcher-plugin-host-vnext.md](/Users/junjieding/dingjunjie_dev/2026_03/openwork/docs/launcher-plugin-host-vnext.md)
- assistant-extension 边界设计，见 [docs/assistant-extension-architecture.md](/Users/junjieding/dingjunjie_dev/2026_03/openwork/docs/assistant-extension-architecture.md)

但它还没有这些真正平台化的东西：

- extension package 级 manifest
- `commands[] / tools[]` 这类统一 entry taxonomy
- extension preferences / storage / supportPath substrate
- extension SDK
- 扩展安装 / 分发 / 发布链路
- AI tools 并入 extension contract

所以今天的 Openwork 更准确是：

`有 plugin 机制，但还没有完整 extension platform。`

## 三者真正的结构差异

### Raycast

结构：

`extension package -> commands / tools / preferences -> host runtime -> human + AI surfaces`

关键点：

- 人和 AI 都消费 extension
- command 和 tool 不属于两套平台

### SuperCmd

结构：

`Raycast extension package -> compatibility parser -> esbuild bundle -> fakeRequire runtime -> launcher surfaces`

关键点：

- 它复刻的是 Raycast extension 的运行方式
- AI tool 这一半没有完整接上

### Openwork

结构目标：

`assistant-core -> consumes extensions / skills / tools -> launcher plugin is one human-facing surface`

关键点：

- 最高抽象不是 command
- 也不应该只是 plugin page
- 而应该是 assistant 可编排的 extension capability

## 如果只问“谁最像 Raycast”

按不同问题，答案不一样。

### 1. 谁最像 Raycast 的产品体验

`SuperCmd`

因为它就是在追 launcher + extension command compatibility。

### 2. 谁最像 Raycast 的 extension platform 结构

`Raycast 自己`

SuperCmd 只复刻到大半。

### 3. 谁最有机会在 agent 时代超过 Raycast

`Openwork`

前提是你们别去抄成 `另一个 launcher + command runtime`，而是真把这些变成第一等平台原语：

- `outputs`
- `approvals`
- `checkpoints`
- `cleanups`

这条线你们在文档里已经很明确了，见 [docs/openwork-raycast-five-primitives.md](/Users/junjieding/dingjunjie_dev/2026_03/openwork/docs/openwork-raycast-five-primitives.md) 和 [docs/deer-flow-reference-notes.md](/Users/junjieding/dingjunjie_dev/2026_03/openwork/docs/deer-flow-reference-notes.md)

## 对 Openwork 的直接建议

不要把目标理解成：

`把 SuperCmd 那套兼容层也抄一遍`

更应该理解成两段：

### 第一段：向 Raycast / SuperCmd 学基础建设

先补齐这些：

- extension manifest v1
- entry taxonomy: `launcher-view / no-view / menu-bar / assistant-tool / background-job`
- preferences / storage / supportPath / cache / secrets
- action runtime
- capability-gated host

### 第二段：在 agent 控制面上超它们

把 extension entry 的结果不只定义成：

- UI
- string
- side effect

而是定义成：

- `outputs`
- `approvals`
- `checkpoints`
- `cleanups`

这时你们超的就不是“能不能跑 Todoist extension”，而是“能不能把 extension 执行纳入可恢复、可审计、可撤销的 agent 工作账本”。

## 最后的硬结论

一句最硬的话：

`SuperCmd 不是完美复刻 Raycast；它复刻得最深的是 Raycast 的 command-extension runtime，不是 Raycast 的完整 extension platform，更不是 Raycast 的 AI-tool platform。`

对 Openwork 的意义也很直接：

`该学它的 compat/runtime/base substrate，但不要把自己的终局做成兼容版 Raycast。你们应该把 extension 做成 assistant-core 的能力层，再把 work-control primitives 压到 platform contract 里。`
