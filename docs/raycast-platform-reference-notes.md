# Raycast Platform Reference Notes

调研日期：2026-03-31

相关本地上下文：

- `docs/assistant-extension-architecture.md`
- `docs/launcher-plugin-host-vnext.md`
- `docs/deer-flow-reference-notes.md`
- `docs/execute-approval-middleware.md`

## 一句话结论

Raycast 的本质不是“一个有很多 API 的 launcher”，而是：

`manifest 驱动的 extension 平台 + 原生 UI runtime + Store / Teams 分发 + AI 作为 extension 的上层编排器`

所以如果只抄它的 launcher 外壳、搜索框和几个 command 页面，最后只会得到一个像 Raycast 的桌面入口；  
如果想尽可能往它的基础建设靠，应该优先抄的是：

- `extension package`
- `entrypoint model`
- `capability contract`
- `command / tool / background lifecycle`
- `storage / preferences / support path`
- `dev / publish / private distribution`

而如果 `openwork` 想在 agent 上超过它，关键不是继续做更多 “AI chat + tool calling”，而是把下面这些做成一等原语：

- `work unit`
- `outputs`
- `cleanups`
- `approvals`
- `checkpoints`
- `rollback`

## Raycast 到底在卖什么

Raycast 官方开发者文档把平台明确定义成两部分：

- `API`
- `Store`

这件事非常关键。  
它意味着 Raycast 的护城河不是单个 API，而是完整闭环：

- extension 作者用熟悉的 TypeScript / React / Node 写功能
- manifest 决定 extension 的暴露面
- Raycast 提供统一 UI、统一运行时、统一系统能力桥
- Store / Teams 负责分发、安装、更新、治理

首页的 `Key features` 实际上暴露了它的产品判断：

- 工具链要熟悉
- UI 要“我来推像素，你来写逻辑”
- DX 要强类型、热重载、现代化
- 分发要内建到平台里

这不是 `AI-first` 叙事。  
这是非常典型的 `extension platform first` 叙事。

## Raycast 的 extension 模型

Raycast 的最小能力单元是 `extension package`。一个 extension 的 `package.json` 既是 npm 包配置，也是 Raycast manifest。它至少声明：

- `commands`
- `tools`
- `ai`
- `preferences`
- `platforms`
- `owner / access`

这里最值得注意的是 3 个 entry surface：

### 1. command

`command` 是人直接进入的入口，支持三种 `mode`：

- `view`
- `no-view`
- `menu-bar`

再加上：

- `interval` 后台定时执行
- `arguments` 调起前参数输入
- `preferences` 命令级配置

这让 Raycast 的 command 不只是一个页面，而是一个统一 entrypoint 生命周期。

### 2. tool

`tool` 不是给人直接打开的页面，也不会出现在 root search。  
它是 `AI` 可调用的 extension entrypoint。

这件事的含义很大：

- `tool` 不是独立产品对象
- 它是 extension 的一个 agent-facing projection
- AI 能力不是另起一套插件系统，而是挂在原 extension package 上

### 3. ai

manifest 里的 `ai` 只有两类东西：

- `instructions`
- `evals`

它不是完整的 agent runtime 定义。  
它更像：

- extension 对 AI 的附加说明
- extension 被 AI 提及时要拼进去的系统上下文
- extension AI 质量的测试资产

所以从结构上看，Raycast AI 不是平台底座，而是 extension 平台上的高权重消费层。

## Raycast 运行时真相

Raycast 官方 security 文档给出的运行时模型非常值得看，因为它直接解释了哪些东西难抄。

它大致是这样：

- 主 app 自己是一个进程
- 每个 extension 跑在单独 child process
- child process 里有 Node.js runtime
- 每个 extension 在自己的 V8 isolate 里执行
- extension 能用的宿主能力，通过一个很薄的 RPC bridge 暴露

这有两个重要含义：

### 1. Raycast 的强项不是“沙箱很重”，而是“宿主边界很清楚”

官方明确说 extension 不是再套一层更重的 OS 沙箱。  
它的控制方式更接近：

- 运行时隔离
- API 白名单
- store review
- 团队分发和治理

这对 `openwork` 很重要，因为它说明：

- 你不必为了“像 Raycast”先做一套极重的安全沙箱
- 你真正该学的是 `capability contract + lifecycle + reviewable surface`

### 2. 真正难抄的是“平台内核”，不是命令页面

一个 launcher 页面、一个搜索框、几个 command UI 很容易做得“看起来像”。  
但如果没有下面这些，你抄到的只是外观：

- extension 装载和卸载
- 隔离执行
- 跨 extension 一致的生命周期
- 宿主 RPC 契约
- 分发、更新、治理

## Raycast 的“Core Features”应该分两层看

如果你说的是首页的 `Key features`，那是平台主张：

- 熟悉工具链
- 原生一致 UI
- 社区和分发
- 强 DX
- 从简单脚本到复杂 React extension 的渐进式能力

如果你说的是文档里的 API surface，那么 Raycast 当前把 extension 能力拆成这些大类：

- `AI`
- `Browser Extension`
- `Cache`
- `Command`
- `Clipboard`
- `Environment`
- `Feedback`
- `Keyboard`
- `Menu Bar Commands`
- `OAuth`
- `Preferences`
- `Storage`
- `System Utilities`
- `User Interface`
- `Raycast Window & Search Bar`
- `Tool`
- `Window Management`

真正该抄的不是“某一项 API”，而是它把这些 API 统一挂在同一套 manifest、runtime、store、DX 上。

## 哪些好抄，哪些难抄

### 好抄

这些基本属于“工程实现问题”，不是 Raycast 独有的产品护城河：

- `manifest 驱动的 extension package`
- `command / tool` 分离
- `view / no-view / background` 这类 entrypoint 模型
- `preferences / arguments / local storage / cache`
- `support path` 这种 extension 私有目录语义
- `CLI + template + hot reload + lint`
- `tool confirmation` 这种 AI side-effect 审批钩子

对 `openwork` 来说，这些几乎都可以直接吸收。

尤其是：

- 你们已经有 `launcher plugin manifest`
- 已经有 `execute approval middleware`
- 已经有 `skill projection`
- 已经有 `checkpoint saver`

所以最该补的是“统一模型”，不是从零发明新概念。

### 中等难度

这些不是不能做，但要做得像 Raycast 一样顺，需要宿主层和产品层一起配合：

- `List / Grid / Detail / Form / ActionPanel` 这类统一 UI primitive
- `menu-bar` 命令和后台刷新
- `launchCommand / popToRoot / closeMainWindow` 这类统一导航语义
- `OAuth + PKCE helper`
- `Browser Extension` 桥接
- `System Utilities` 的一部分

它们难的地方不在 API 名字，而在：

- 生命周期一致性
- UI 一致性
- 键盘操作一致性
- 平台差异处理
- 错误和权限体验

### 难抄

这些才是 Raycast 更深的系统能力：

- `Store + Teams + private store + publish pipeline`
- `review + CI + 分发 + 自动更新`
- `extension runtime isolation + thin RPC`
- `AI API` 的统一模型接入、计费、权限、fallback
- `Window Management`
- `Browser Extension` 的成熟联动
- `root search / main window / menu bar / background` 的统一产品闭环

这些难，不是因为写不出来，而是因为它们跨越了：

- 平台 runtime
- 操作系统集成
- 开发者生态
- 组织分发
- 商业化计费
- 质量治理

### 按能力项粗分

| 能力 | 判断 |
| --- | --- |
| `Manifest / Command / Tool / Preferences / Storage / Cache` | 好抄 |
| `UI primitives / menu bar / background refresh / OAuth` | 中等 |
| `Window & Search Bar control / Browser Extension` | 中难 |
| `Window Management / AI API broker / Store / Teams / runtime isolation` | 难抄 |

## Raycast 到底是 AI-first，还是 extension-first

我的判断是：

`架构上是 extension-first，产品增长上是 AI 强曝光，但不是 AI-first。`

证据很直接：

### 1. 官方平台定义先讲 API + Store，不先讲 AI

这说明 Raycast 的平台中心不是“模型”，而是“extension ecosystem”。

### 2. 官方文档明确说：AI extension 是“把 regular extension 变成 AI-powered one”

这个表述非常重要。  
它不是说“先有 AI agent，再给它挂 extension”。  
它说的是：

- 先有 regular extension
- 再给 extension 加 `tools`
- 让 Raycast AI 可以调用它

这就是标准的 extension-first。

### 3. tool 只是 extension 的一个 entrypoint

tool 没有自己的独立包模型，没有自己独立分发模型。  
它从属于 extension manifest。

### 4. ai.instructions 是 extension 被 AI 提及时追加的系统上下文

这也说明 AI 是在消费 extension，不是在定义 extension。

## 但为什么很多人会误以为它是 AI-first

因为 Raycast 把 AI 做成了很强的上层入口：

- root search 里可以直接 `Ask ...`
- AI Chat 里可以 `@extension`
- extension 可以很低成本暴露给 Raycast AI
- `AI.ask` 又是开箱即用、无需 API key 的统一模型能力

这让用户感受到的是“AI 到处都在”。  
但架构层真相仍然是：

`AI 是 Raycast extension 平台上的 privileged super-surface`

不是整个系统的第一抽象。

## 这对 Openwork 的启发

Raycast 的分层其实刚好能帮你把 `openwork` 的层次讲清楚：

- `assistant-core` 是主角
- `extension` 是能力包
- `launcher` 是人类入口面
- `tool / skill` 是 extension 面向 assistant 的投影

这里和 Raycast 的关键差异是：

- Raycast 的第一抽象更接近 `command`
- `openwork` 的第一抽象应该是 `work unit`

这点不能抄错。

如果把 Raycast 的 `command` 直接抄成 Openwork 的第一能力单元，你最后会得到一个更 AI 化的 launcher；  
你不会得到一个真正的工作控制系统。

## Openwork 应该抄 Raycast 的哪些基础建设

### 1. 单一 manifest 事实源

继续沿着你们已经在做的方向走：

- `launcher page`
- `assistant skill / tool`
- `host capabilities`
- `rpc methods`
- `preferences`
- `background ability`

都应该由同一份 extension manifest 派生。

不要再让 renderer / main / preload 各自维护半份 registry。

### 2. 明确 entrypoint 类型

至少应该把 Openwork entrypoint 分成：

- `launcher-view`
- `background-job`
- `assistant-tool`

如果以后有 menu bar 或 system surface，再加新的 surface；  
不要让所有 extension 都被默认等同成一个 React page。

### 3. capability 要显式声明

Raycast 的一个强点，是 extension 不是“拿到整个宿主对象”，而是被限定在宿主公开的 API 里。  
你们现在已经有 `clipboard / navigation / rpc / surface / threads`，这条路是对的。

后续应该继续补：

- `workspace`
- `outputs`
- `approvals`
- `checkpoints`
- `cleanups`

### 4. 每个 extension 要有自己的持久化语义

Raycast 有：

- `supportPath`
- `LocalStorage`
- `Cache`
- `Preferences`

Openwork 也应该有自己的对应层：

- extension 级 support dir
- work-unit 级 workspace / outputs / logs
- extension 级 preferences / secrets

不要把所有状态都塞进 thread message 或 renderer local state。

### 5. dev / build / publish 也要是平台能力

Raycast 的强处之一不是 API，而是作者体验极顺：

- create
- dev
- lint
- build
- publish

Openwork 就算暂时不做 public marketplace，也应该尽早把：

- create extension
- register extension
- run in dev
- inspect capabilities
- load into assistant-core

做成固定流程。

## Openwork 不该照抄 Raycast 的地方

### 1. 不要把 `command` 当成最高级对象

Raycast 适合 `command-first`，因为它是 launcher 产品。  
Openwork 不适合。

Openwork 更应该是：

- `work unit` 为一等对象
- `thread` 是 work unit 的交互面之一
- `extension command / tool` 是 work unit 的执行面资源

### 2. 不要把 “AI extension = tools 数组” 当成终局

Raycast 的 AI extension 核心是：

- 给 AI 多几个工具
- 给 extension 多一点 instructions / evals

这对 Raycast 成立，因为它的产品目标是“让 AI 能用更多 extension”。  
但对 Openwork 不够。

Openwork 需要的不只是 `tool-callable capability`，而是：

- 能生成什么 `output`
- 会留下什么 `side effect`
- 怎么 `cleanup`
- 何时需要 `approval`
- 产生哪些 `checkpoint`
- 是否可以 `rollback`

### 3. 不要过早抄 Store / Marketplace 叙事

Raycast 的 Store 很重要，但那是它的平台闭环，不是你们当前的最优先项。  
你们当前更需要的是先把 first-party 和 internal extension contract 做对。

## Openwork 要怎样在 agent 上超过 Raycast

关键不是让 agent 比 Raycast AI 更聪明。  
关键是让 agent 所调用的 extension，比 Raycast 的 tool 更“可治理”。

### 1. `outputs` 做成一等对象

建议每次 extension / assistant tool 调用，都不要只返回一段文本。  
应该允许返回结构化 output：

- `artifact type`
- `title`
- `body or file path`
- `producer`
- `draft / final`
- `adopted / rejected / published`
- `diff target`
- `provenance`

这样主工作台上看到的就不再只是消息，而是可采用、可比较、可发布的工作产物。

### 2. `cleanups` 做成一等对象

Raycast 几乎没有把 cleanup 做成产品层的一等结构。  
这正是 `openwork` 可以超车的地方。

建议每个 extension / tool 都能声明：

- 生成了哪些临时文件
- 开了哪些后台资源
- 留下了哪些外部副作用
- 哪些能自动清理
- 哪些需要用户确认清理

这样 `cleanup` 不再是散落在脚本里的“顺手删除”，而是 work unit 的治理能力。

### 3. `approval` 不要只拦 execute

你们现在已经有 `execute approval middleware`。  
下一步应该把 approval 扩成通用 runtime 语义：

- 覆盖文件前审批
- 对外发送前审批
- 发布输出前审批
- 清理资源前审批
- 覆盖已有 artifact 前审批

Raycast 的 `Tool.Confirmation` 是个好起点，但还只是工具级确认。  
Openwork 应该把它提升成工作级控制点。

### 4. `checkpoint / rollback` 要和 outputs 绑定

Raycast 有 runtime、storage、confirmation，但没有很强的“工作回退面”。  
Openwork 可以把这层做成自己的核心差异：

- checkpoint 记录状态边界
- output adoption 形成显式提交点
- rollback 撤回到上一个已确认状态

这样用户不是在看 agent 日志，而是在管理一条工作账本。

## 一个更适合 Openwork 的 extension 形状

下面这个方向比直接照搬 Raycast 更适合你们现在的架构：

```ts
type OpenworkExtensionRole = "assistant-core" | "feature" | "tool"

type OpenworkEntrySurface = "launcher-view" | "background-job" | "assistant-tool"

interface OpenworkExtensionManifest {
  id: string
  role: OpenworkExtensionRole
  capabilities: string[]
  entries: Array<{
    id: string
    surface: OpenworkEntrySurface
  }>
  skills?: Array<{
    source: string
  }>
  outputs?: Array<{
    type: string
    adoptable?: boolean
    publishable?: boolean
  }>
  cleanups?: Array<{
    type: string
    approvalRequired?: boolean
  }>
}
```

这里的关键不是字段名，而是 3 个边界：

- `extension` 是能力包
- `assistant-core` 是唯一主角
- `outputs / cleanups` 是 extension contract，而不是 UI 补丁

## 推荐路线

### 第一阶段：先追平 Raycast 的 extension 基建

- 一份统一 manifest
- `launcher-view / background-job / assistant-tool` 三类 entrypoint
- capabilities 显式声明
- extension support dir / preferences / secrets
- 开发态注册、热更新、调试入口

### 第二阶段：把 work control plane 做出来

- work unit ledger
- outputs registry
- cleanup registry
- approvals registry
- checkpoints / rollback

### 第三阶段：让 assistant-core 真正压过 Raycast

- assistant 规划时感知 extension `outputs / cleanups / approvals`
- tool 结果默认进入 artifact ledger，而不是淹没在消息流里
- adopt / reject / publish 成为标准动作
- cleanup 成为可见、可确认、可追踪的系统机制

这样你们学到的是 Raycast 的平台骨架，超越它的是 `work control` 这一层。

## 最终判断

如果只问一句：

`Raycast 值得抄什么？`

答案不是它的 AI chat，而是它这套：

- `manifest-first`
- `extension package`
- `entrypoint discipline`
- `capability-gated host`
- `native-consistent UI`
- `dev/build/publish/store`

如果只问一句：

`Openwork 应该怎么超过它？`

答案也不是“更强模型”，而是：

`把 extension 调用收口成 work unit，并让 outputs、cleanups、approvals、checkpoints、rollback 成为平台原语。`

## 官方资料

- https://developers.raycast.com/
- https://developers.raycast.com/information/manifest
- https://developers.raycast.com/information/file-structure
- https://developers.raycast.com/information/lifecycle
- https://developers.raycast.com/information/lifecycle/background-refresh
- https://developers.raycast.com/information/developer-tools/cli
- https://developers.raycast.com/information/security
- https://developers.raycast.com/api-reference/user-interface
- https://developers.raycast.com/api-reference/tool
- https://developers.raycast.com/api-reference/ai
- https://developers.raycast.com/api-reference/window-and-search-bar
- https://developers.raycast.com/api-reference/window-management
- https://developers.raycast.com/api-reference/browser-extension
- https://developers.raycast.com/api-reference/preferences
- https://developers.raycast.com/api-reference/storage
- https://developers.raycast.com/api-reference/cache
- https://developers.raycast.com/api-reference/oauth
- https://developers.raycast.com/ai/create-an-ai-extension
- https://developers.raycast.com/ai/learn-core-concepts-of-ai-extensions
- https://developers.raycast.com/ai/follow-best-practices-for-ai-extensions
- https://developers.raycast.com/teams/getting-started
- https://developers.raycast.com/teams/publish-a-private-extension
