# Jingle 路线图

[English](roadmap.md) | [简体中文](roadmap.zh-CN.md)

Jingle 是一个 Raycast 级别的启动器，也是一套可检查的 Agent runtime。

Raycast 是 Jingle 的体验标杆：命令发现、键盘速度、扩展开发、单命令 preferences、
AI Commands、AI Extensions、Agents、Skills 和 MCP 类集成，都应该足够顺手。Jingle
要在这个基础上往前走一步：当 AI Agent 真的开始替用户做事时，用户仍然能看见过程、
控制权限、恢复现场。

关键不只是聊天，而是 execution harness。一次有意义的 Agent run 不应该只留下一段
对话记录，还应该留下输入、权限、checkpoint、工具结果、artifact、diff，以及足够让
用户理解发生了什么的历史。

## 产品原则

- 启动器是入口。开始工作应该快速、可搜索、键盘友好。
- Agent runtime 拥有执行事实：计划、工具调用、checkpoint、审批和可恢复工作。
- Session 是工作界面，不是一次性聊天标签。任务超过一次 run 时，session 应该能被引用、
  关联和协作。
- Renderer 只投影状态，不应该为了隐藏契约缺口而编造 runtime 事实。
- 扩展应该像 Raycast extensions 一样容易上手，同时能暴露可被 Agent 安全调用的工具。
- 标签、状态、来源和 assignee 是产品事实，不应该藏在 message 文本里。
- 本地数据属于用户。记忆、checkpoint、设置和工作区上下文都应该可检查、可迁移。

## Raycast 基线，Jingle 方向

Jingle 会有意保留用户熟悉的启动器基线：

- 命令搜索应该足够快
- extension commands 应该容易用 React 和 TypeScript 构建
- preferences、OAuth、storage、menus 和导航应该像 host app 的原生能力
- AI commands、AI extension tools、可复用的 agent instructions 和 MCP 类集成都应该是一等入口

Jingle 在这条基线上继续往前走：它要为更长时间的 Agent 工作提供 execution model。一个
session 不应该只是聊天窗口，还应该拥有可持久化状态、source work 链接、权限、状态、
标签、artifact、diff，以及和其他 session 通信时留下的可观察记录。

## 1. 启动器基础

Jingle 在接入 AI 之前，先应该是一个好用的桌面工具。

重点方向：

- 快速搜索应用、命令、扩展和线程
- 可预测的键盘导航
- 从 launcher 进入 AI 的清晰路径
- launcher、settings 和 pinned session 的稳定窗口行为
- 面向长时间任务的原生桌面状态入口

好的状态是：打开 launcher、找到命令、启动 AI 线程、审批工具、回到原任务，这些动作像
同一个桌面工作流，而不是几个拼起来的页面。

## 2. Agent Runtime

Agent 工作需要可持久化的状态，也需要用户随时能接管。

重点方向：

- thread history 和可恢复 run
- 保存工作现场的 checkpoint
- 能说明 Agent 想做什么的审批请求
- 带证据的文件、shell 和 extension tool 结果
- 核心状态与派生投影分离，例如搜索、摘要和展示缓存

好的状态是：用户可以停止、恢复、检查和解释一次 Agent run，而不是依赖隐藏在进程里的
临时状态，或某个脆弱的 UI 截图。

## 3. Work Items、Sessions 和协作

Agent 工作通常从一句话开始，但很快会变成一个需要管理的工作对象：bug、草稿、调研、
release task，或者来自 extension 的后续动作。Jingle 需要在普通聊天之上有一层 work
layer，让多个 session 可以协作，而不是把所有状态都塞进 message list。

重点方向：

- 带 title、body、source、tags、status、priority、assignee 和 workspace context 的
  work item
- 同一个 workspace 或 goal 下可以有多个活跃 session
- 用 parent-child session 表达委派任务或并行 Agent 工作
- session 之间可以通信，并保留 sender、recipient、intent 和后续 action
- session inbox/outbox 用于展示 work request、handoff、review note 和 blocker
- active、waiting、review、blocked、done 这类状态分组
- tags 和 labels 可以用于搜索、分组、路由和 extension actions
- extension 可以建议 tags，但只有被 Jingle 接受后才变成 host-owned tags
- work item、session、tool run、artifact、diff、外部 issue 和 extension item 之间有
  durable links

扩展可以参与这层，但不拥有这层。GitHub issue、Notion page、Figma file、reminder 或
自定义 extension item 都应该能提供类似「Work on this」「Summarize with Jingle」的动作。
extension 提供 source item 和建议动作；Jingle 创建 work item，选择或创建 session，跟踪
状态，并记录执行证据。extension 可以通过 typed actions 请求工作状态流转，也可以读取
自己贡献 item 对应的 host-owned projection，但不应该直接写 runtime truth。

好的状态是：用户能看到多个 Agent session 正在处理相关工作，知道哪些被 blocked、哪些
ready for review，也能让 extension 发起工作，但 extension 不能直接写 runtime truth。

## 4. 扩展平台

扩展决定 Jingle 能不能长出自己的生态。

重点方向：

- 公开的 `@jingle/extension-api`、`@jingle/extension-utils` 和
  `@jingle/extension-cli`
- 使用 React 和 TypeScript 构建 extension commands
- preferences、storage、OAuth、menu bar commands 和 trust boundaries
- 带 typed input 和可见 output 的 Agent-callable tools
- 迁移 Raycast extension 常见模式的工具链
- 能把 extension item 转成 work request 的 extension item actions
- 面向 extension 的 status/tag hooks，但 work state 仍由 host 拥有

好的状态是：扩展作者既能写普通 UI command，也能暴露 Agent 可调用的工具，而且不需要
依赖 Jingle 的私有内部 API。

## 5. 本地记忆和工作区上下文

Jingle 应该记住有用的上下文，但不能替用户接管数据。

重点方向：

- 本地优先的 memory storage
- 带可见路径的 workspace rules 和 context sources
- 给 Agent runtime 使用的简洁 context pack
- 清晰的编辑、删除和来源语义
- 本地优先的产品路径不依赖 cloud sync

好的状态是：用户能看到 Jingle 记住了什么，能修改、删除，也能理解这些信息什么时候被
用进 Agent 上下文。

## 6. 公开项目质量

仓库应该让新贡献者看得懂、跑得起来、改得动。

重点方向：

- 清晰的 README、roadmap、contributing、security、support 和 release 文档
- MIT license 和准确的 package metadata
- 能收集有效复现信息的 issue templates
- 要求贡献者说明 owner boundary 的 PR template
- runtime、extension、storage 和 renderer 边界文档
- 可重复执行的本地 build、test 和 desktop packaging 命令

好的状态是：陌生贡献者能 clone 仓库、运行应用、找到改动 owner，并带着合适的检查开 PR。

## 命名

公开项目名是 Jingle。代码、包名、schema、事件、工具和持久化字段里的稳定标识应该使用
`jingle`。

## 第一版公开发布不做什么

- memory cloud sync
- 用宽泛 fallback 掩盖契约问题
- extension package contract 稳定前做 marketplace
- 旧项目名或旧协议的兼容层
