# Artifact Tab Roadmap

## 目标

把 `artifact` 从“右侧 inspector 的附属内容”收口成 `AI history` 主工作区里的一级内容对象：

- 用户可以从任意 artifact 入口打开它
- artifact 一律在顶部 tab 区打开
- tab 内根据 artifact 类型展示对应 viewer
- 关闭 tab 后返回之前的工作上下文

当前已经完成一部分基础设施，但这件事还没有闭环。

## 产品边界

这次只做 `artifact tab workflow`，不扩成新的平台层。

明确边界：

- `RightPanel`
  只负责 artifact 列表、轻量选择、打开入口
- `ThreadContext`
  只负责当前 thread 的 tab 状态和已打开 artifact 状态
- `TabbedPanel`
  负责决定当前显示 `agent / file / artifact`
- `ArtifactViewer`
  负责 artifact tab 的壳层和类型路由
- `FileViewer`
  只负责 managed file artifact 的具体文件渲染
- `artifact-preview/*`
  负责非文件型 artifact 的具体内容展示

不做的事情：

- 不再恢复“聊天页内部右侧 pane 打开 artifact”
- 不把 artifact viewer 状态散落到 `RightPanel`、`ChatContainer`、`Messages` 多处
- 不为了未来类型提前抽象成复杂 registry；先保留清晰的类型路由

## 当前状态

已完成：

- inspector 中点击 artifact 会打开顶部 tab
- artifact tab 已接入 `TabbedPanel`
- 文件型 artifact 走 `FileViewer`
- `summary / patch / link` 已拆成独立 preview 组件
- artifact 读取 IPC 已补齐

未完成：

- 聊天消息里的 `present_artifacts` 列表项还不能直接打开 tab
- artifact tab 的行为测试还没补
- viewer 的视觉和交互还比较基础
- artifact 更新后的已打开 tab 同步策略还没明确

## 实施落点

这一轮不要散着改，直接按边界落到下面这些文件：

- `src/renderer/src/components/chat/tools/PresentArtifactsTool.tsx`
  负责把聊天里的 artifact 列表做成可点击入口
- `src/renderer/src/lib/thread-context.tsx`
  负责唯一的 `openArtifactTab / closeArtifactTab / activeTab` 语义
- `src/renderer/src/components/tabs/TabBar.tsx`
  负责 artifact tab 的展示、切换、关闭、回退一致性
- `src/renderer/src/components/tabs/TabbedPanel.tsx`
  负责 `agent / file / artifact` 三种主区域内容的分发
- `src/renderer/src/components/tabs/ArtifactViewer.tsx`
  负责 unavailable state、header action、viewer 路由
- `src/renderer/src/components/chat/artifact-preview/*`
  负责各 artifact kind 的具体渲染
- `tests/bdd/features/artifact-tabs.feature`
  新增主行为场景
- `tests/bdd/steps/artifact-tabs.steps.ts`
  新增对应步骤定义

这里最关键的约束不是 UI，而是“消息项如何稳定映射到真实 artifact”。

- `PresentArtifactsTool` 渲染层拿到的是工具参数和 `toolCall`
- 持久化后的 `ArtifactRecord` 上有 `toolCallId`
- 所以聊天入口应优先按 `toolCall.id -> artifact.toolCallId` 建立关联
- 禁止退化成只按 `title/path/url` 模糊匹配；这会在重名文件和重复 summary 时出错

## Phase 1: 统一打开入口

目标：
所有用户能看到 artifact 的地方，都走同一条 `openArtifactTab` 路径。

范围：

- `RightPanel` 的 artifact 卡片
- 聊天消息中的 `present_artifacts` 工具结果
- 后续如果有 artifact 搜索结果，也复用同一路径

实现要求：

- 定义单一入口：
  `threadState.openArtifactTab({ artifactId, title, kind })`
- 禁止在调用方自行拼 tab 状态
- `PresentArtifactsTool` 内部先解析出“当前 tool call 对应的 artifacts”，再渲染点击行为
- 优先使用 `toolCall.id === artifact.toolCallId` 过滤，再按当前列表顺序映射具体项
- 重复点击同一个 artifact 不重复开 tab，只切换到该 tab

验收：

- 从 inspector 点击 artifact，顶部出现 tab
- 从聊天中的 artifact 项点击，同样打开同一个 tab
- 同一个 artifact 连点两次不会产生两个 tab

## Phase 2: 完整 tab 生命周期

目标：
artifact tab 的打开、切换、关闭行为和 file tab 一样稳定。

范围：

- tab title
- tab icon
- close 行为
- 中键关闭
- 关闭后的 fallback tab 选择

实现要求：

- `TabBar` 同时支持 `openFiles + openArtifacts`
- 关闭当前 artifact tab 时：
  优先回到左侧相邻 tab
  如果没有其它 tab，则回到 `Agent`
- artifact tab id 保持稳定：
  `artifact:{artifactId}`

验收：

- 可以切换 `Agent / file / artifact`
- artifact tab 可关闭
- 关闭当前 artifact tab 后，焦点回退合理

## Phase 3: Viewer 质量收口

目标：
先把已有 artifact 类型做成“可用”，再扩新类型。

优先顺序：

1. `summary`
   更稳定的 markdown 呈现，处理长文滚动和标题层级
2. `patch`
   提升 diff 可读性，必要时引入更强 diff viewer
3. `file`
   图片、PDF、代码、音视频的打开体验统一
4. `link`
   补更清晰的 metadata 和打开反馈

后续类型：

- `html`
- `table`
- `decision`
- `image`

这些不在这轮先做，只保留扩展位。

验收：

- markdown summary 可稳定阅读
- inline patch 可稳定查看
- managed file artifact 能进入对应 viewer
- link artifact 可复制、可打开

## Phase 4: 状态同步与更新语义

目标：
artifact 更新后，已打开 tab 的内容保持一致，不出现“tab 还在但内容是旧的”。

需要明确的语义：

- 同 `artifactId` 内容更新：tab 复用还是强制刷新
- artifact 被删除或失效：tab 显示什么
- artifact 列表变化时：已打开 tab 是否保留

推荐策略：

- `artifactId` 不变时，tab 保留，viewer 读取最新 artifact 数据
- 当前 thread 的 `artifacts` 更新后，`ArtifactViewer` 直接从 thread state 重新取 artifact
- 如果 artifact 已不存在，显示明确的 unavailable state，而不是 silent fallback

验收：

- artifact 更新后，已打开 tab 内容同步
- artifact 消失时，tab 不崩溃，有明确提示

## Phase 5: 测试闭环

目标：
把这条主工作流变成稳定行为，而不是手测约定。

优先测试层级：

1. BDD
   覆盖用户行为
2. 组件级
   覆盖 tab 路由和 close 行为

BDD 场景建议：

### Scenario 1

- Given thread 中存在一个 file artifact
- When 用户在 inspector 点击该 artifact
- Then 顶部出现 artifact tab
- And 主区域显示 artifact viewer

### Scenario 2

- Given thread 中存在一个 artifact tab
- When 用户关闭该 tab
- Then 当前视图回到 `Agent` 或相邻 tab

### Scenario 3

- Given assistant 刚执行 `present_artifacts`
- When 用户在聊天结果中点击某个 artifact 项
- Then 打开同一个 artifact tab，而不是聊天内弹层

## 推荐执行顺序

按这个顺序推进：

1. 补聊天中的 artifact 点击打开 tab
2. 补 artifact tab 关闭/回退测试
3. 打磨 `summary` 和 `patch` viewer
4. 明确 artifact 更新后的同步语义
5. 再考虑新 artifact 类型

## 最小交付切片

为了避免这件事一直停在“快完成”状态，建议按 3 个小切片交付：

### Slice A

- 聊天中的 `present_artifacts` 项可点击
- inspector 和聊天入口打开的是同一个 tab
- 重复点击不重复开 tab

### Slice B

- artifact tab 可关闭
- 关闭后焦点回退稳定
- 补 BDD：inspector 打开、消息打开、关闭回退

### Slice C

- `summary / patch / link / file` viewer 各自补到可用线
- 明确 artifact 更新/失效时的 tab 表现

## 完成标准

这件事算完成，不是“能打开一个 tab”就够了，而是满足下面四条：

- 所有主要入口都能打开同一个 artifact tab
- artifact tab 生命周期稳定
- 现有 artifact 类型都有清晰 viewer
- 有自动化测试覆盖主行为

如果缺任意一条，这件事都还只是半成品。
