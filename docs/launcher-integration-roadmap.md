# 启动器集成路线图

## 目标

以小步、可验收的方式，把 `Jingle` 的启动器能力合并进 `openwork`。

目标体验：

- 用全局快捷键唤起启动器窗口
- 在启动器里搜索已安装应用
- 直接从结果中启动应用
- 在启动器输入内容后按 `Tab` 进入 `openwork` 的 AI work 流程

## 决策

`openwork` 作为主项目保留。

第一阶段只迁移 `Jingle` 的启动器相关能力：

- 启动器窗口以及显示/隐藏行为
- 全局快捷键
- 已安装应用搜索
- 结果列表与执行流
- 真正需要时再接入少量系统辅助能力

第一阶段明确不引入 `Jingle` 的插件体系：

- 插件市场
- 插件运行时
- 插件管理界面
- WebDAV 同步
- Rubick adapter 体系

## 工作规则

1. 同一时间只推进一个阶段。
2. 每个阶段结束后暂停，等代码验收。
3. 没有验收通过，不进入下一阶段。
4. 每个阶段都要保持在可运行状态。
5. 优先新增独立模块，避免大范围重构。

## 阶段总览

### Phase 0：路线图与边界

范围：

- 记录方案
- 固定迁移方向
- 明确哪些做，哪些不做

验收标准：

- 仓库中存在 roadmap 文档
- 阶段边界清晰

### Phase 1：启动器外壳

范围：

- 在 `openwork` 中加入独立的启动器窗口
- 加入全局快捷键注册
- 实现显示/隐藏行为
- 保持现有 AI 主窗口行为不受影响

验收标准：

- 快捷键可以正常唤起启动器
- 启动器被唤起时保持顶层
- 应用启动仍然稳定
- 现有 `openwork` 主流程不受影响

Phase 1 子步骤：

- `1.1` 独立启动器窗口
  - 独立 `BrowserWindow`
  - 默认全局快捷键
  - 在当前屏幕上显示
  - 在 macOS 下尽量保持顶层，并尽量覆盖全屏场景
  - 加入最基本的收起行为，便于早期验收
  - 这一阶段不做搜索
- `1.2` 窗口生命周期打磨
  - 收紧尺寸、位置和拖拽区行为
  - 完善 `Esc` 收起行为
  - 让唤起后的焦点与当前空间行为更稳定
  - 降低 macOS launcher 层级，保证输入法候选窗优先显示
- `1.3` 启动器外壳接口
  - 定义搜索输入框和结果列表的 renderer 接口
  - 固定 `shellConfig + query + results + selectedIndex` 这组最小 contract
  - 补齐结果区高度和键盘选中态的壳逻辑
  - 在 Phase 2 / Phase 3 之前，不把它和 AI thread 逻辑耦合

### Phase 2：应用搜索

范围：

- 搭建可扩展的 launcher search 架构
- 把应用搜索作为第一个 provider 接入
- 从主进程向启动器 renderer 暴露通用搜索 API
- 搭建基础输入框和结果列表 UI

验收标准：

- 可以在启动器里搜索已安装应用
- 搜索结果稳定、可理解
- 后续接浏览器历史、文件搜索、语义检索时，不需要改搜索主链路

Phase 2 子步骤：

- `2.0` 搜索架构解耦
  - 抽出 `provider -> search service -> IPC -> shell adapter` 四层
  - renderer 不再直连某一种搜索实现
  - 搜索响应中带上 provider 级诊断信息，方便排查问题
- `2.1` applications provider
  - 先做 macOS 已安装应用发现
  - 作为第一个 provider 接入通用搜索总线
  - 启动器输入后返回真实应用结果
  - 这一阶段不做应用启动
  - 这一阶段不做复杂排序，只保留可解释的基础匹配
- `2.2` provider 稳定性
  - 预热应用目录缓存
  - 收敛无结果、扫描中、重复结果的状态
  - 补齐基础排序规则，让结果顺序更稳定
- `2.3` provider 扩展
  - 视验收情况补 Windows / Linux 的应用发现实现
  - 后续在同一总线上接浏览器历史、文件搜索、语义检索

Phase 2 当前状态：

- `2.0` 已完成
- `2.1` 已完成
- `2.2` 已完成
- `2.3` 保留为后续扩展项，不阻塞当前 Phase 2 验收
- 结合当前验收反馈，应用结果的点击/回车启动已提前落地；AI thread 打通仍留在 `Phase 3`

### Phase 3：结果执行与 AI 入口

范围：

- 执行启动器结果项
- 从搜索结果直接启动应用
- 把启动器输入框中的 `Tab` 映射到 AI work 入口
- 用当前输入作为初始 prompt，创建或打开 AI thread

验收标准：

- 选中的应用可以成功启动
- 按 `Tab` 可以把输入正确送入 AI 流程
- AI thread 能带着正确的初始内容打开

Phase 3 子步骤：

- `3.1` 二级页壳与注册
  - 把 launcher 二级页从 `LauncherApp` 中拆出
  - 引入 `page registry + route shell + page config` 结构
  - 先注册 `ai` 作为第一个二级页
  - `Tab` 和右侧入口按钮都能进入 `ai` 页
  - 支持返回、空输入 `Backspace` 返回、页面切换动画
  - 这一阶段只做壳，不接 thread
- `3.2` thread 与 launcher 根目录
  - `thread` 创建必须挂在“第一次发送”这个明确提交点，而不是挂在 page navigation 上
  - `useLauncherShell` 只保留搜索、导航、窗口壳；不再承载 AI thread 生命周期
  - launcher AI 进入后默认继承全局 workspace，不再引入 `os.homedir()` 兜底
  - AI 的 create / submit / resume 收口到独立 `launcher-ai` 模块
  - launcher 会话先视为私有会话；是否提升到主应用 thread 列表，后续单独定义
- `3.3` message / tool / HITL 复用
  - 抽一个共享的 `thread conversation state / stream projection` 层
  - 主 chat 与 launcher AI 共用消息投影、stream 合并、todos、tool result、HITL 恢复逻辑
  - launcher 的 `ai` 二级页中展示消息、tool call、审批状态
- `3.4` AI 发送链路
  - 二级页输入真正接到 agent 发送流程
  - 第一次发送时 lazy-create thread，并马上提交首条消息
  - 不做“进入即自动发送”

Phase 3 当前状态：

- `3.1` 已完成
- `3.2` 已完成
- `3.3` 已完成基础共享层
- `3.4` 已完成首条消息发送链路
- launcher shell 边界重切已落档：`docs/launcher-shell-architecture.md`

### Phase 4：基础工具层

范围：

- 只迁移启动器和 AI 流程真正需要的系统辅助能力

验收标准：

- 只加入有明确使用场景的工具能力
- 不把 `Jingle` 的系统工具整包搬过来

Phase 4 子步骤：

- `4.1` 剪贴板上下文感知
  - 独立抽出 launcher clipboard 服务，不并入 search provider
  - launcher 会话级感知文本 / 文件 / 图片三类上下文
  - 文本在输入为空时自动回填到当前页输入框
  - 文件 / 图片以上下文 chip 形式展示，并支持当前会话内清除
  - 上下文状态挂在 launcher shell，而不是挂在某个具体 page
- `4.2` local-start 手动固定项
  - 参考 `Jingle` 的 local-start
  - 支持手动固定 app / 文件 / 文件夹，并进入 launcher 搜索
  - 不做全盘文件索引
  - `4.2.1` 先落持久化模型和存储：`LocalStartItem`
  - 第一版记录 `useCount / lastUsedAt`，为后续搜索排序做准备
  - 第一版先用独立 `electron-store`，不提前引入 sqlite 表
- `4.3` 截图进入工作流
  - 参考 `Jingle` 的 screen-capture
  - 只在明确接入 launcher AI / 图像链路时再落地

Phase 4 当前状态：

- `4.1` 已完成
- `4.1` 图片上下文已扩展为可预览 payload，当前 launcher header 可直接显示缩略图
- launcher header 的 clipboard 图片预览与 AI attachment strip 已开始复用同一套 attachment UI，图片缩略图支持 hover 大图
- clipboard 能力边界已开始收口为：`snapshot -> consumer derivation -> surface consumption`
- launcher home / launcher plugin 不再直接各自理解原始 clipboard 语义；后续 AI composer 继续沿同一模式接入
- launcher AI 已引入独立 `attachment draft` 映射层；当前 clipboard 图片/文件先映射成只读 attachment strip，上传/截图/发送后续接入同一模型
- launcher AI 的 `attachment draft` 已支持单项移除；`+` 按钮当前可选择本地图片文件并加入同一附件条
- launcher AI 的 `attachment draft` 已接入实际发送链：用户消息区可直接回显图片/文件附件；发送成功后当前 attachment draft 会清空
- 图片附件当前会在提交边界转换成 provider-friendly 的 `image_url` 内容块，不需要对象存储
- 文件附件当前先走“消息显示 + 文件名摘要”最小闭环：消息区可见，模型侧先收到文件名摘要文本；真正的 file ingestion / upload 后续单独迭代
- launcher AI 当前先限制为一组常见可接入文件：`pdf/doc/docx/xls/xlsx/csv/ppt/pptx/txt/md/png/jpg/jpeg/webp/gif/bmp/tif/tiff/heic/heif`
- `4.2` 进行中
- `4.2.1` 已完成：数据模型、独立存储、IPC/preload 已落地
- `4.3` 未开始

### Phase 5：排序与扩展项

范围：

- 优化结果排序
- 视情况加入本地固定项或手动 local-start 项
- 视情况补充更丰富的最近记录/历史行为
- 收敛 launcher result `action` 模型，避免继续沿用字符串命令或临时字段堆叠
- 对齐 `Jingle` 的空态语义：优先补 `launcherHistory + pin`

Phase 5 子步骤：

- `5.1` history + pin
  - 空输入时展示 `Jingle` 风格的 history 宫格
  - 应用 icon 正常回显
  - tile 只保留 pin 角标
  - `pin / unpin / remove` 收口到右键菜单
- `5.2` 排序规则收紧
  - 继续收敛搜索结果排序的可解释性
  - 明确 history、pin、搜索匹配之间的优先级
  - 不引入复杂黑盒评分
- `5.3` action 模型收口
  - 把 launcher result action 收成结构化模型
  - `executeLauncherAction` 只做分发，不混入搜索逻辑

后续优化记录：

- `action` 设计改为三段式：`type + executor + target`
- `type` 表示用户意图，例如 `open-application`、`open-file`、`open-url`、`ai-thread`
- `executor` 表示执行通道，例如 `shell`、`electron`、`internal`，后续如有需要再接 `rubick-base` / `rubick-native`
- `target` 或 `payload` 只承载执行参数，不把平台差异藏进字符串命令
- 搜索 provider 只产出结构化 action，不直接拼 `open` / `start` / `exec` 命令
- `executeLauncherAction` 只做 action 分发，不承载搜索或排序逻辑
- 参考结论：`Jingle` / `rubick-core` 当前没有更好的 typed action 答案，现有实现基本仍是字符串命令，后续优化以 `openwork` 自己的结构化模型为准
- clipboard 上下文协议后续从单一互斥 union 演进为更通用的 snapshot / items 模型，支持文本、文件、图片及未来更多剪贴板通道并存
- clipboard 图片预览和 AI 页上传/截图最终收敛到统一 attachment 模型；clipboard 只是 attachment 的来源之一
- launcher plugin manifest 可声明 clipboard 接受类型；host 负责过滤后再暴露给 plugin，避免 plugin 自己理解全部 clipboard 原始语义
- launcher shell 级共享状态后续禁止继续通过 page render props 逐层下传，统一收口到 launcher 根 context / shell 边界
- `launcherHistory` 数据层已提前落地：独立持久化、pin 字段、执行后自动写入；空态展示后续再接 UI
- `browser-history` source 已开始接入：当前先支持 macOS 下 Chrome / Edge 本地历史搜索，结果进入现有 `search-results` section，执行先复用 `open-url`
- 后续 `Source` backlog：
  - `FilesLauncherSearchProvider`
  - `BrowserBookmarksLauncherSearchProvider`
  - `ClipboardIntentSource`
  - 这几类统一按 `class X implements LauncherSearchProvider` 的风格落地，只在 source 层类化，不向 `Candidate / SurfaceModel / Action` 扩散

Phase 5 当前状态：

- `5.1` 已完成
- `5.2` 已完成
- `5.3` 已完成

说明：

- `5.2` 的排序与 section ranker 收口，已在后续的 Pause 1 / Pause 4 / Pause 5 中落地
- `5.3` 的结构化 action / executor 收口，已在 Pause 2 中落地

验收标准：

- 排序调整是可解释、可验证的
- 新增项类型在代码上仍然容易理解

## 架构收口 Pause

这组 pause 按 [launcher-architecture-principles.md](/Users/junjieding/dingjunjie_dev/2026_03/openwork/docs/launcher-architecture-principles.md) 执行。

原则：

- 先收口边界，再加新能力
- 每一步都必须可独立验收
- 每一步尽量不改变已有用户可见行为

### Pause 1：Candidate identity 收口

目标：

- 把结果 identity 从 `action` 中解耦
- 明确 `Candidate / Result` 自己的 `identityKey` 或 `historyKey`

范围：

- `applications` 等 source 在产出结果时直接带上稳定 key
- `launcherHistory` 去重不再反推 `action`
- `home-surface` 排序不再理解执行协议

验收标准：

- 现有搜索、history、pin 行为不变
- `home-surface` 不再通过 `action` 反推 history key
- 后续新增结果类型时，不需要先改 `action -> dedupeKey`

### Pause 2：Action / Executor 收口

目标：

- 把 launcher action 明确拆成 `type + executor + target`
- 让执行层只负责分发，不再承载搜索或 history 语义

范围：

- 把当前已有 action 迁到结构化模型
- `executeLauncherAction` 改成小型 dispatch table
- 先只覆盖已有 action，不顺手加新动作

验收标准：

- 现有应用打开、local-start 打开、页面跳转行为不变
- `executeLauncherAction` 代码里不再混入搜索或排序逻辑
- 新增 action 类型时，只需要新增协议和一个 executor 分支

### Pause 3：Clipboard 边界收口

目标：

- 把 clipboard 从“页面里顺手处理”收成明确的三层边界

范围：

- `snapshot`：原始剪贴板状态
- `derivation`：launcher 消费策略，例如 text autofill、attachment draft 映射
- `consumption`：home / ai / plugin page 的具体展示与交互

验收标准：

- 现有 clipboard 文本自动回填、图片/文件 preview 行为不变
- `useLauncherSearchPage` 不再直接理解 clipboard 消费协议
- 后续新增 clipboard intent 时，不需要再回到页面 hook 里改一整段逻辑

### Pause 4：Home Surface 合约收口

目标：

- 把首页“显示什么、怎么排、默认选中谁”继续收口到 `SurfaceModel`

范围：

- 明确 `body / chrome / sections / defaultSelection`
- `useLauncherSearchPage` 只负责 query、请求、执行、导航
- `section` 内部排序保留在 surface builder，而不是散在 page hook 和组件里

验收标准：

- 空输入 history、idle、有输入 results 行为不变
- 首页 section 组装和默认选中策略有唯一落点
- 以后新增 `suggestions` 或 `inline action` 时，不需要改动多处组件判断

### Pause 5：Suggestion Surface 首次落地

目标：

- 在不污染 search provider 的前提下，引入首页 suggestion 能力

范围：

- 新增 `suggestions` section
- 第一批只做两类 suggestion：
  - 浏览器搜索
  - 点击后只填充输入框的补全建议
- suggestion 来自 `SurfaceModel` 派生，不进入 source/provider 主链

验收标准：

- 应用搜索主链不变
- suggestion 与 search results 能并存，且边界清晰
- 点击 suggestion 的行为分别是：
  - 浏览器搜索：执行动作
  - 输入补全：只改 query，不执行

### Pause 6：Input Affordance 首次落地

状态：

- 已跳过

目标：

- 把“输入行即时动作”作为 `SurfaceModel` 的第一个显式 affordance 落地

范围：

- 输入框右侧显示 inline primary action，例如 `- 打开`
- 只在 top result 置信度足够高时展示
- 点击行为等价于对当前主结果执行一次主动作

验收标准：

- 输入明确应用名时，输入框右侧出现 `- 打开`
- 点击后直接打开目标应用
- 清空输入或 top result 不够明确时，该 affordance 消失
- 这条能力不新增 provider，也不污染结果列表结构

### Pause 7：Result Identity / Semantics 收口

目标：

- 继续做减法，把 result 的 identity 和展示语义从零散 helper / switch 中收拢

范围：

- `7.1` 统一 `historyKey` 构造入口，移除按类型散落的多个 helper
- `7.2` 统一 `kind` 的展示语义定义，例如 icon、category、primary action label

验收标准：

- 行为不变
- provider / executor / presentation 的依赖关系更直接
- 新增 result kind 时，不需要再沿多处平铺 helper 和 switch 追加

建议顺序：

1. Pause 1
2. Pause 2
3. Pause 3
4. Pause 4
5. Pause 5
6. Pause 6
7. Pause 7

当前状态：

- Pause 1 已完成
- Pause 2 已完成
- Pause 3 已完成
- Pause 4 已完成
- Pause 5 已完成
- Pause 6 已跳过
- Pause 7.1 已完成

## 当前不做

- Rubick 插件体系
- Rubick adapter
- 类似 Spotlight / Alfred 的全盘文件搜索
- 插件市场界面
- 云同步和 WebDAV
- 大规模架构重写
