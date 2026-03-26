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

后续优化记录：

- `action` 设计改为三段式：`type + executor + target`
- `type` 表示用户意图，例如 `open-application`、`open-file`、`open-url`、`ai-thread`
- `executor` 表示执行通道，例如 `shell`、`electron`、`internal`，后续如有需要再接 `rubick-base` / `rubick-native`
- `target` 或 `payload` 只承载执行参数，不把平台差异藏进字符串命令
- 搜索 provider 只产出结构化 action，不直接拼 `open` / `start` / `exec` 命令
- `executeLauncherAction` 只做 action 分发，不承载搜索或排序逻辑
- 参考结论：`Jingle` / `rubick-core` 当前没有更好的 typed action 答案，现有实现基本仍是字符串命令，后续优化以 `openwork` 自己的结构化模型为准
- clipboard 上下文协议后续从单一互斥 union 演进为更通用的 snapshot / items 模型，支持文本、文件、图片及未来更多剪贴板通道并存
- launcher shell 级共享状态后续禁止继续通过 page render props 逐层下传，统一收口到 launcher 根 context / shell 边界
- `launcherHistory` 数据层已提前落地：独立持久化、pin 字段、执行后自动写入；空态展示后续再接 UI

验收标准：

- 排序调整是可解释、可验证的
- 新增项类型在代码上仍然容易理解

## 当前不做

- Rubick 插件体系
- Rubick adapter
- 类似 Spotlight / Alfred 的全盘文件搜索
- 插件市场界面
- 云同步和 WebDAV
- 大规模架构重写
