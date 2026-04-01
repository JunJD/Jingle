# Entry Taxonomy Primer

## 为什么下一步先看这个

当前 Openwork 的插件机制，最像的是：

`launcher-view plugin`

也就是：

- 有 manifest
- 有 entry
- entry 最终会挂成一个 renderer 里的页面

这已经够支撑今天的内建插件，但还不够支撑一个更完整的 extension 平台。

下一步最值得先拉齐的，不是 manifest 字段，也不是 RPC 细节，而是：

`entry 到底有几种形态`

因为如果 entry 形态不先分清：

- manifest 不知道该描述什么
- host 不知道该注什么能力
- RPC 不知道在服务谁
- assistant 入口和人类入口会继续混在一起

## 这层到底是什么

`entry taxonomy` 说的不是 UI 风格，而是运行形态。

同样都叫一个 extension entry，它可能是：

- 打开一个页面
- 不开页面，直接执行
- 常驻 menu bar
- 给 assistant 调用
- 在后台定时跑

这些不是一个抽象。

## Raycast 里这几个 entry 分别是什么

### 1. `launcher-view`

这是最传统的 command。

特征：

- 从根搜索打开
- 会挂一个完整页面
- 常见形态是 `List` / `Form` / `Detail` / `Grid`
- 用户在页面里继续交互

例子：

- `Todoist / My Tasks`
- `Apple Reminders / My Reminders`

对 Openwork 的映射：

- 你们现在的 built plugin entry，基本都属于这一类

### 2. `no-view`

这是“不挂页面，只执行”的 command。

特征：

- 从 launcher 触发
- 接 arguments
- 直接执行副作用
- 常见结果是 `close window / show toast / 写数据 / 调 API`
- 不需要 mount 一个持续存在的 React 页面

Raycast 例子：

- `Todoist / Quick Add Task`
- `Apple Reminders / Quick Add Reminder`

这类 entry 的本质不是“少一个页面”，而是：

`它是一个用户手动触发的 action entry`

对 Openwork 的意义很大，因为很多动作根本不值得先开一个页。

### 3. `menu-bar`

这是“常驻系统表层”的 entry。

特征：

- 不依赖主 launcher 页面
- 有自己的轻量交互树
- 常见能力是显示状态、快速操作、定时刷新
- 往往会配 `interval`

Raycast 例子：

- `Todoist / Menu Bar Tasks`
- `Apple Reminders / Menu Bar Reminders`

这类 entry 的本质不是“另一种页面”，而是：

`持续暴露状态和快捷动作的 presence surface`

它比 launcher-view 更接近系统壳层。

### 4. `assistant-tool`

这是给 AI 调的入口，不是给人点开的入口。

特征：

- 无需页面
- 输入输出要稳定、可序列化
- 通常要有确认、审批或 side-effect guard
- 返回的是结构化结果，不是一个 UI 会话

Raycast 例子：

- `Apple Reminders` 里的 `create-reminder / get-reminders / update-reminder`

这类 entry 的第一职责不是“让用户看”，而是：

`让 agent 可调用`

这点和 command 是两套心智模型。

### 5. `background-job`

这是后台执行入口。

特征：

- 可以定时或事件触发
- 不依赖用户当前正在看一个页面
- 更像 worker / sync task / watcher
- 结果通常投影到 cache、store、notification、menu bar、assistant context

Raycast 并没有把这类东西永远单独命名成一个独立 manifest 顶层，但 `interval`、menu bar refresh、后台同步逻辑，本质上已经在用这类能力。

对 Openwork 来说，这类 entry 很关键，因为未来的：

- cleanups
- outputs
- checkpoint compaction
- sync / refresh / indexing

都更像 background-job，不像页面 command。

## 为什么这一步比 manifest 更先

因为 manifest 只是描述层。

如果你现在先写 `extension manifest v1`，但还没决定 entry 到底分几类，manifest 很容易写成一堆混杂字段：

- 有些字段只对页面有意义
- 有些字段只对 tool 有意义
- 有些字段只对后台任务有意义

最后 manifest 会越来越像“一个巨大的可选字段包”。

这不是好架构。

正确顺序应该是：

1. 先把 entry 形态分开
2. 再决定每类 entry 需要哪些 manifest 字段
3. 再决定 host 对每类 entry 注哪些能力

## 为什么这一步也比 host / RPC 更先

因为 host 和 RPC 只是执行底座。

如果你还没想清：

- 这是页面 entry
- 还是 no-view action
- 还是 tool
- 还是后台 job

那你就不知道：

- 它需不需要 navigation
- 它需不需要 surface
- 它该不该有 threads
- 它能不能直接做副作用
- 它的失败应该 toast、return 结构化错误，还是进入 job ledger

所以 host / RPC 不能先抽象。

## Openwork 现在卡在哪

一句话：

`现在的 entry 几乎都被当成 launcher-view。`

这会带来三个后果：

- 需要无界面的动作时，也容易被迫先开页面
- assistant 能力和 launcher entry 没有清晰分叉
- 后台型能力没有自然落点

## 这一步拉齐后，下一步该做什么

不是立刻大改全平台。

只做一件小事：

`把当前 entry 先分型，不改大运行时。`

最小做法可以是：

- 在共享层先定义 `entry.kind`
- 第一版只支持：
  - `launcher-view`
  - `no-view`
  - `menu-bar`
- `assistant-tool` 和 `background-job` 先定义类型，不立即全做完

这样做的价值是：

- 认知先清楚
- manifest 开始变得可收敛
- 后面每一步改造都有落点

## 当前建议

下一步不要先改 host，也不要先重写 manifest。

先做一个很小的认知与代码收口：

`把现有 entry 从“默认都是 view”升级成“显式 kind”`

这是最小、最干净、也最能让你看懂架构的一步。
