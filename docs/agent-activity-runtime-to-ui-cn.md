# Agent Activity 从 Runtime Event 到 UI

这份文档说明 AI launcher 里工具调用、思考块和等待态的完整链路。边界目标是：runtime 只产出可恢复的运行事实，renderer store 保存 shared state，projection 生成 view model，UI 组件只负责结构和动效。

## 快速入口

先按这张表读代码，不需要从页面组件一路猜到 runtime：

| 要看什么 | 入口 | 说明 |
|---|---|---|
| LangChain stream 如何变成 runtime event | `src/main/agent/agent-thread-runner.ts` 的 `ThreadRuntimeProjector.applyStreamPayload` | 解码 messages/values stream，写 `message.upserted`、`message.part.delta`、`tool.callUpdated`、`tool.started`、`tool.updated`、`approval.requested` |
| streaming tool args 如何累计 | `agent-thread-runner.ts` 的 `StreamingToolCallAccumulator` | 以 tool call `id` 或同一 assistant message 下的 `index` 合并 tool name 和 args 文本 |
| active run 保存哪些 tool 事实 | `src/shared/agent-thread-runtime.ts` 的 `ActiveAgentRun` / `ActiveAgentToolCall` | `currentToolCallId` 和 `toolCalls` 是 active status 和正式 tool row 状态的事实来源 |
| event 如何归约成 state | `agent-thread-runtime.ts` 的 `reduceAgentThreadRuntimeEvent` | tool chunk、正式 tool call、tool result、approval 都在这里改变 active run |
| renderer store 如何更新 view | `src/renderer/src/lib/agent-runtime-event-projector.ts` | 先更新 `thread.agent`，再从 messages/active run 派生 `thread.view.messageProjection` |
| messages 如何分 turn 和 activity | `src/renderer/src/lib/message-projection.ts` | `buildTurnAssistantEntries` 只按正式 assistant messages 把 think/tool/message 拆成可渲染 entries |
| chat row 如何订阅 active tool facts | `src/renderer/src/components/chat/Messages.tsx` 的 `MessageTurnRow` | 只给 active turn 选择 `activeToolCallId`、`activeToolCalls`、`pendingApproval` |
| think/tool/message 如何渲染 | `src/renderer/src/components/chat/MessageTurnView.tsx` | `ActiveTurnStatusRow`、`ReasoningBlock`、`ThinkingActivityContent`、`AgentActivityGroup`、`AssistantBlock` |
| 单个 tool row 如何渲染 | `src/renderer/src/components/chat/ActionMessage.tsx` | 把 tool render model 变成 standalone/grouped UI，处理状态、展开、meta 和 elapsed time |
| tool display 如何统一成 title/detail/meta | `src/renderer/src/components/chat/action-message-view.ts` | `createActionMessageView` 是展示文案归一入口 |
| tool UI 结构封装 | `src/renderer/src/components/agent-ui/Tool.tsx` | `AgentTool`、`AgentToolInline`、`AgentToolGroup`、`AgentToolGroupItem` |
| running 文案动效 | `src/renderer/src/components/agent-ui/TextShimmer.tsx` 和 `src/renderer/src/index.css` | `TextShimmer` 只负责文字高光；CSS 里定义 shimmer 和 reduced motion |

## 外部参考和本地取舍

这次调研只吸收和当前实现有关的模式：

| 参考 | 观察 | Openwork 取舍 |
|---|---|---|
| [assistant-ui Reasoning](https://www.assistant-ui.com/docs/ui/reasoning) | reasoning 是独立 message part/group，用 collapsible trigger、active streaming 判断、短时长折叠动画和 shimmer 表示正在推理。 | Openwork 保留 `ReasoningBlock` / `ThinkingActivityContent` 两条展示路径，但都只消费 projection；running shimmer 收到 `TextShimmer`，折叠动效走 Radix/CSS。 |
| [Vercel AI Elements](https://github.com/vercel/ai-elements) / [AI Elements 介绍](https://vercel.com/blog/introducing-ai-elements) | AI chat 组件按 message、reasoning、tool、response actions 等 AI-specific parts 拆分，并作为 shadcn 风格的“可复制进项目的源码组件”使用。 | Openwork 不引入新组件库；把可复用结构沉淀到本仓 `components/agent-ui`，让 tool/think/messages 共享本地 token 和 Electron 桌面节奏。 |
| [CopilotKit Tool Rendering](https://docs.showcase.copilotkit.ai/built-in-agent/generative-ui/tool-rendering) | tool UI 按 tool name 注册专用 renderer，同时提供 default renderer；UI 反馈紧贴 tool call。 | Openwork 对应 `components/chat/tools` registry + `extensionToolComponent`；未知非 extension tool 直接暴露 renderer 缺失错误，不在组件层猜展示文案。 |
| [CopilotKit HITL Overview](https://docs.copilotkit.ai/human-in-the-loop) | HITL 有 tool-based 和 graph-paused 两类；UI 需要能在 agent 暂停时呈现用户输入/审批。 | Openwork 当前采用 runtime interrupt / `pendingApproval` 事实驱动 UI；审批属于 shared runtime state，approval card 是它的展示投影。 |

共同结论：reasoning、tool rendering、HITL 都应该是明确的 message/runtime part，而不是从普通文本里靠组件猜。Openwork 的实现因此坚持 `runtime event -> shared state -> projection -> UI`，不在组件层新增“看起来能跑”的 fallback 状态。

## 边界定义

| 层 | Owner | 输入 | 输出 | 不做什么 |
|---|---|---|---|---|
| Runtime event | `src/main/agent/agent-thread-runner.ts` | LangChain stream payload、HITL interrupt、tool result | `AgentThreadEventBatch` | 不写 renderer 展示状态，不决定动画 |
| Shared state | `src/shared/agent-thread-runtime.ts` | `AgentThreadEvent` | `AgentThreadRuntimeState.activeRun/messagesPage/pendingApproval` | 不解析 UI 文案，不保存组件展开态 |
| Renderer store | `src/renderer/src/lib/thread-store-core.ts` | runtime snapshot/event | `thread.agent` 和 `thread.view` | 不跨层补一份假 agent state |
| View projection | `src/renderer/src/lib/message-projection.ts` | messages、`activeRun.toolCalls`、tool results、approval | turn entries、active status、tool execution view | 不执行 tool，不改变 runtime state |
| UI structure | `MessageTurnView`、`ActionMessage`、`agent-ui/Tool` | projection model | activity group、tool row、thinking row | 不从文本猜核心工作状态 |
| Motion tokens | `TextShimmer`、`index.css` | `active/running` 展示态 | 局部 shimmer、chevron、badge | 不阻塞输入、导航或 runtime 继续 |

## Runtime Event

`ThreadRuntimeProjector` 是运行事实入口：

- `tool_call_chunks` 到达时，`StreamingToolCallAccumulator` 合并同一个 tool call 的 `name/argsText/id/index`，发出 `tool.callUpdated`。
- 完整 assistant tool call 到达时，先通过 `message.upserted` 写入 assistant message，再发出 `tool.started`。
- tool result 到达时，先写入 tool message，再发出 `tool.updated`。
- HITL interrupt 到达时发出 `approval.requested`。

这让首个完整 assistant message 出现之前，也能显示“正在准备工具”这类 active status。工具组标题仍然只来自正式 assistant message 的 `tool_calls`，不从 active args 流拼一个临时工具组。这些事实只表达运行状态：当前 tool call 是谁、参数流到哪里、是否在等结果或审批。它们不是 UI 状态。

事件顺序的实际语义：

| 场景 | 事件 | state 变化 | UI 结果 |
|---|---|---|---|
| 用户刚提交，assistant 还没内容 | `run.started` / `run.resumed` | `activeRun.phase = "thinking"`、`assistantMessageId = null` | active turn 显示 `ActiveTurnStatusRow` |
| provider 开始流 tool args，但完整 tool call 还没进 message | `tool.callUpdated` | `activeRun.toolCalls[]` 增加/更新 `arguments_streaming` tool | active turn status 显示 `preparing_tool` |
| 完整 assistant tool call 到达 | `message.upserted` + `tool.started` | assistant message 有正式 `tool_calls`，active tool 标成 `running` | 正式 tool row 出现，并由 active facts 显示 running |
| tool result 到达 | `message.upserted` tool message + `tool.updated` | `toolResults` 可被 projection 读取，active tool 从 `toolCalls` 移除 | tool row 进入 complete |
| HITL 审批出现 | `approval.requested` | `pendingApproval` 保留，active run status 变成 `waiting_approval` | tool row 显示 approval 状态 |

## Shared State

`ActiveAgentRun` 是 active turn 的 shared runtime state：

```ts
{
  assistantMessageId: string | null
  currentToolCallId: string | null
  phase: "thinking" | "streaming" | "tool_running" | "waiting_tool_result" | null
  status: "running" | "waiting_approval"
  toolCalls: ActiveAgentToolCall[]
}
```

reducer 负责把事件归约成事实：

- `tool.callUpdated`：更新 `activeRun.toolCalls`，phase 进入 `tool_running`。
- `tool.started`：把对应 active tool call 标成 `running`。
- `message.upserted` 的 tool result：移除对应 active tool call。
- `approval.requested`：保留 pending approval，并把对应 tool call 标成 `waiting_result`。
- `run.finished`：结束 active run；如果仍有 pending approval，线程保持 interrupted。

状态失败语义保持直接：事件 revision 过旧就忽略；投影或 UI 失败不反向决定 runtime 写入是否成立。

## View Projection

renderer store 的分层仍是：

```ts
thread.agent // runtime/schema-backed shared state
thread.view  // renderer derived view
thread.ui    // local UI state
```

`agent-runtime-event-projector` 先调用 shared reducer 更新 `thread.agent`，再从新的 messages 和 active run 派生 `thread.view.messageProjection`。

工具活动 view 由三步生成：

1. `buildTurnAssistantEntries(turn)` 只按 assistant messages 生成 reasoning/tool/content entries；tool activity 只来自正式 assistant message 的 `tool_calls`。
2. `projectActiveTurnStatus(...)` 合并 active tool facts、streaming assistant、pending approval 和 tool execution view，输出当前 turn 的 loading/status row：`understanding_request / thinking / preparing_tool / running_tool / waiting_tool_result / waiting_approval / composing_answer`。
3. `projectTurnToolExecutionsView(...)` 合并 tool results、active tool facts 和 pending approval，输出正式 tool call 的展示状态：`arguments_streaming / running / waiting_result / approval / complete`。

active tool facts 不生成临时 tool activity，不解析 streaming args 做标题，也不把工具展示 metadata 写进 runtime state。工具标题、detail、extension presentation 的 owner 是正式 assistant message `tool_calls` 上的 `display / presentation`，由 `ActionMessage` 和 tool renderer 消费。

### Projection 规则

`message-projection.ts` 里有三类输出：

- `assistant-content`：普通 assistant message 内容，交给 `AssistantBlock` 渲染。
- `agent-activity`：连续的 think/tool activity，被合并成一个 activity group。
- `footer`：虚拟列表稳定 footer，不属于 agent activity。

`AgentActivityItem` 有两种：

- `thinking`：来自 assistant content blocks 里的 `type === "reasoning"`。
- `tool`：来自正式 assistant message 的 `tool_calls`。

不要在组件里重新从 raw message 猜这些分类。需要改变 activity 分组或排序时，优先改 `buildTurnAssistantEntries`，再补 `tests/node/message-projection.test.ts`。

## UI Structure

UI 分三层消费 projection：

- `Messages.tsx`：每个 turn row 用 selector 只取当前 turn 需要的 `activeToolCallId / activeToolCalls / pendingApproval`，避免 page 层拥有工具展示状态。
- `MessageTurnView.tsx`：把 entries 渲染成 assistant content、thinking activity、tool activity group；group header 使用最新活动的 title/detail。
- `ActionMessage.tsx`：把单个 tool call 的 render model 交给 `createActionMessageView`，再渲染 standalone 或 grouped tool row。

### Messages 渲染分流

`MessageTurnView.tsx` 是 `messages` 里的关键分流点：

| 输入 entry | 渲染组件 | 展示语义 |
|---|---|---|
| 没有 assistant entry 且 active turn 正在 streaming | `ActiveTurnStatusRow` | 首 token 前的 assistant 状态行，不新建假 message |
| `assistant-content` | `AssistantBlock` | 正常回答、附件、非 reasoning 的 structured content |
| 单个 `thinking` activity | `ReasoningBlock` | 单独的 think/reasoning 折叠块 |
| 多个 activity 或 tool activity | `AssistantActivityCluster` -> `AgentActivityGroup` | think + tool 的连续时间线 |
| 单个 `tool` | `ActionMessage` | 单个工具行，保持可展开 detail |

`renderStructuredContent` 会把 assistant content blocks 拆成 attachments、reasoningContent、textContent。正常回答默认 `includeReasoning: false`，reasoning 不混进普通 markdown。

### Think / Reasoning

当前有两个 reasoning 展示路径：

- `ReasoningBlock`：用于 assistant message 内容里的 reasoning block，作为独立折叠块显示。
- `ThinkingActivityContent`：用于 activity group 内的 `thinking` item，标题行用 `TextShimmer` 表达 streaming 状态，正文仍是可展开的 pre-wrap 文本。

它们都只消费 projection 结果，不持有 runtime 状态。是否 streaming 由 `isThinkingItemStreaming(item, { isStreaming, streamingAssistantId })` 判断：只有当前 streaming assistant message 的 reasoning item 才闪动。

### Tool

tool 的展示从 `ActionMessage` 开始：

- `createActionMessageView` 选 tool renderer：优先 registry 中的专用 tool component，其次 extension tool renderer；没有 renderer 的非 extension tool 直接抛错。
- `normalizeToolRenderModel` 统一 result、approval、status。
- tool renderer 返回 `ToolDisplay` 的 `title / detail / resultMeta`，由 `ActionMessage` 统一进入 header 结构。
- grouped tool row 用 `AgentToolInline`；standalone 或展开态用 `AgentTool`。
- `ToolExecutionTime` 只在 active tool 进入 `running` 后本地计时；它不是 runtime fact，也不会写回 shared state。

如果新增 tool renderer，只改 `src/renderer/src/components/chat/tools/*` 和 registry，display 仍通过 `ActionMessage` 统一进入 UI。

工具 UI 结构收口在 `src/renderer/src/components/agent-ui/Tool.tsx`：

- `AgentTool`：有 detail 的独立 tool block。
- `AgentToolInline`：完成态或 group 内的紧凑行。
- `AgentToolGroup / Trigger / Content / Item`：连续 thinking/tool activities 的时间线容器。
- `AgentToolStatusBadge / AgentToolStatusIcon`：审批、运行、完成、错误状态。
- `TextShimmer`：运行中文案动效，不让业务组件自己拼动画 DOM。

`action-message-view.ts` 只做展示模型归一：tool renderer 输出的 `ToolDisplay` 被规整成 `title/detail/resultMeta`，组件层不再重复组织 header 文案。

## 动效约束

动效只挂在 activity UI 层：

- `TextShimmer` 通过 `active` 控制文字高光，不改变 layout。
- `AgentToolGroupTrigger` 和 `AgentToolInline` 只在 `arguments_streaming/running` 时激活 shimmer。
- `ToolExecutionTime` 只在 tool 进入 `running` 后显示本地 elapsed time；它不进入 runtime state。
- `index.css` 里统一 `ow-text-shimmer-*` token，并在 `prefers-reduced-motion: reduce` 下关闭动画但保留可读状态。

### 动效实现点

`TextShimmer` 的 DOM 结构是两层文字重叠：

- `data-slot="ow-text-shimmer-base"`：普通文字。
- `data-slot="ow-text-shimmer-highlight"`：高光文字，只有 `data-active="true"` 时显示。

CSS 里的 `ow-text-shimmer-cadence` 只动画 `background-position`，不改 layout。`--ow-text-shimmer-index` 允许 title/detail 使用不同 offset，避免同一行所有文字完全同步闪动。

折叠展开动效由 `.ow-agent-tool-content[data-state="open|closed"]` 接 Radix Collapsible 的 `--radix-collapsible-content-height`。chevron 用 `.ow-agent-tool-chevron[data-open="true"]` 或 Radix `group-data-[state=open]` 旋转。

所有 motion 都必须有 reduced motion 路径。当前 CSS 在 `prefers-reduced-motion: reduce` 下关闭 shimmer、collapsible height animation 和 chevron transition。

## 改动 Checklist

改 tool/think/messages UI 时，按这个顺序检查：

1. 这个事实是否影响继续、恢复、审批、取消或可审计结果？如果是，进 runtime event/state；如果只是展示，进 projection/UI。
2. 是否已有 `activeRun / pendingApproval / messagesPage / toolResults` 能表达？能表达就不要新增 state。
3. 是否在 `message-projection.ts` 生成了稳定 view model？不要在 React 组件里临时从 raw text 猜。
4. 是否只让 active turn 订阅 active tool facts？不要让 page 或整棵 launcher 订阅所有流式细节。
5. 是否通过 `ActionMessage` / `agent-ui/Tool` 复用 tool 结构？不要在每个 tool renderer 里复制 header、chevron、shimmer。
6. 动效是否只使用 opacity/transform/background-position 或 Radix height？不要让动画改变 layout 或阻塞输入。
7. 是否补了定向测试：runtime reducer、runner event、message projection、thread store 中至少命中受影响边界。

验收时看三件事：

1. 首 token 前显示 active turn status row；tool args streaming 时显示 active status，不生成临时工具组。
2. 完整 tool call/result 到达后，preview 收敛到正式 tool row，结果进入 complete。
3. running 文案动效局部、可折叠、无 layout shift，reduced motion 下仍可读。
