# Messages 感知等待改造方案

目标：用户发出消息后，`messages` 区域不能出现“系统像没动”的空窗。每个等待阶段都应该在当前 turn 附近给出轻量、稳定、可恢复的反馈：我收到了、我在想、我在准备工具、工具在跑、我在等结果或等你审批、我正在输出答案。

这不是新增一套 loading state。等待感知必须从现有 runtime facts 派生：

```txt
activeRun
pendingApproval
messagesPage
toolResults
messageProjection
```

UI 反馈只进入 renderer projection / component，不反向写 runtime state。

## 当前状态

当前代码已经落下这条消息区等待反馈链路：

| 阶段                               | 当前事实                                                                                      | 当前 UI                                           |
| ---------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| 用户刚提交，assistant 还没任何内容 | `activeRun.status = "running"`、`assistantMessageId = null`、active turn 没有 assistant entry | `MessageTurnView` 显示 `ActiveTurnStatusRow` 的“正在理解请求” |
| reasoning block 到达               | assistant content 里有 `type === "reasoning"`                                                 | `ReasoningBlock` 或 `ThinkingActivityContent`     |
| tool args 正在 streaming           | `activeRun.toolCalls[].status = "arguments_streaming"`                                        | `ActiveTurnStatusRow` 显示“正在准备工具”          |
| 完整 tool call 到达                | assistant message 有 `tool_calls`，active tool status 进入 `running`                          | `ActionMessage` / `AgentToolInline` 显示 tool row |
| tool result 到达                   | tool message 写入，turn `toolResults` 可读                                                    | tool row 进入 complete                            |
| HITL 出现                          | `pendingApproval` 指向 tool call                                                              | tool row 进入 approval                            |

关键代码入口：

- `src/renderer/src/components/chat/Messages.tsx`：`MessageTurnRow` 只给 active turn 选择 `activeToolCallId / activeToolCalls / pendingApproval`。
- `src/renderer/src/components/chat/MessageTurnView.tsx`：`ActiveTurnStatusRow`、`AssistantActivityCluster`、`AgentActivityGroup`、`AssistantBlock`。
- `src/renderer/src/lib/message-projection.ts`：`buildTurnAssistantEntries`、`projectActiveTurnStatus`、`projectTurnToolExecutionsView`。
- `src/renderer/src/components/chat/ActionMessage.tsx`：单个 tool row 的状态、title/detail/meta。
- `src/renderer/src/components/agent-ui/Tool.tsx` 和 `TextShimmer.tsx`：tool/think 的结构和动效。

## 体验问题

这次改造的目标是把 waiting row、正式 tool row 和 approval 串成一个连续的 active turn 叙事，而不是让用户看到分散的技术事实。

主要问题：

1. 首 token 前用 `understanding_request` 填掉空白，而不是固定 “Working”。
2. thinking、tool args streaming、tool running、waiting result、approval 都投影成同一套 active status。
3. tool row 和 activity group header 复用 `createActionMessageView` 的 title/detail，让 collapsed 状态也能看出当前步骤。
4. final answer streaming 开始后不额外抢注意力，让正在输出的文字成为主反馈。
5. 长等待只在 UI 本地显示 elapsed，不写回 runtime state。

## 改造原则

1. **反馈贴在 message turn 里。** 不用全局 toast，不在 composer 上重复显示同一件事。
2. **由 runtime facts 派生。** 不新增 `isAwaitingFirstAssistant`、`isThinkingVisible` 这类状态；状态源仍是 `activeRun / pendingApproval / messages / toolResults`。
3. **一条 active narrative。** 用户始终能在当前 turn 看见一个当前动作：`Working`、`Thinking`、`Preparing tool`、`Running tool`、`Waiting for approval`、`Answering`。
4. **短等待安静，长等待更具体。** 0-800ms 可以只显示轻提示；800ms 后显示阶段文案；3s 后显示更具体的 tool/detail/elapsed。
5. **动效表达“还活着”，不表达“很忙”。** 文字 shimmer、微弱 loader、chevron/collapsible 即可；不要堆多个 spinner。
6. **布局稳定。** 等待行、tool row、activity group 尺寸要稳定，不能因为状态文案切换导致大幅跳动。

## 目标感受

用户视角应该是这样：

```txt
我：帮我检查 GitHub issue 并总结

Jingle：正在理解请求...
Jingle：正在查询 GitHub · search issues
Jingle：已查询 12 条结果
Jingle：正在整理答案...
Jingle：这里是总结...
```

不是每一步都要单独撑大成卡片。默认应该是紧凑的一行 timeline；需要 detail 时再展开。

## 分阶段方案

### Phase 1：Active Turn Status Row

把固定等待行升级为 active turn status row。

输入仍来自 `MessageTurnView` 的 props：

```ts
isStreaming
streamingAssistantId
activeToolCalls
pendingApproval
toolExecutions
assistantEntries
```

派生规则：

| 条件                                                                | 文案                                       | 动效                                        |
| ------------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------- |
| `assistantEntries.length === 0` 且 `activeRun.phase === "thinking"` | 正在理解请求                               | `TextShimmer`                               |
| 有 streaming reasoning                                              | 正在思考                                   | `TextShimmer`                               |
| 有 `arguments_streaming` tool                                       | 正在准备工具                               | `TextShimmer`                               |
| 有 `running` tool                                                   | 正在运行 + elapsed                         | tool row active + elapsed                   |
| 有 `waiting_result` tool 且无 approval                              | 正在等待工具结果                           | calm loader                                 |
| 有 `pendingApproval`                                                | 等待你确认 · `{tool title}`                | warning badge，无 shimmer                   |
| assistant text 正在 streaming                                       | 正在回答                                   | 不额外加动效，让文字 streaming 自己成为动效 |

实现位置：

- `src/renderer/src/lib/message-projection.ts` 暴露 `projectActiveTurnStatus(...)`，只输出阶段、位置和 tool id。
- `MessageTurnView.tsx` 用 `ActiveTurnStatusRow` 渲染阶段文案和长等待 elapsed；工具名称/detail 只留给正式 tool row。

验收：

- 首 token 前不空白。
- tool args streaming 时状态文案从“正在理解请求”变成“正在准备工具”。
- final answer streaming 时不和文字流动抢注意力。

### Phase 2：Activity Group Header 更像“当前步骤”

当前 `AgentActivityGroup` 已经会用 latest tool title/detail 做 header。下一步是把 header 明确成当前步骤：

```txt
正在准备工具 · GitHub Search
正在运行 · Read File src/...
已执行 3 个步骤
等待你确认 · Execute command
```

实现点：

- 继续复用 `createActionMessageView` 的 `display.title/detail`。
- `AgentActivityGroup` 内部从 `actionViews` 派生 `headerState`：
  - `thinking.streaming`
  - `tool.status === "arguments_streaming"`
  - `tool.status === "running"`
  - `tool.status === "waiting_result"`
  - `tool.status === "approval"`
  - no active actions -> completed summary
- header 的 active shimmer 只在 `arguments_streaming / running / thinking.streaming` 时开。

不要做：

- 不把 headerState 写入 `thread.agent`。
- 不让 tool renderer 自己写 header。
- 不在每个 tool component 里重复“正在运行”文案。

### Phase 3：Long Wait Escalation

长等待不是新状态，而是 UI 本地对同一个 active fact 的时间感知。

建议阈值：

| 时间     | UI                           |
| -------- | ---------------------------- |
| 0-800ms  | 只显示轻量 loader/shimmer    |
| 800ms-3s | 显示阶段文案                 |
| 3s+      | 显示 elapsed 或更具体 detail |

已有 `ToolExecutionTime` 可以继续服务 running tool。首 token 前也可以做一个本地 elapsed，但只显示在 3s 后：

```txt
正在理解请求 · 3.2s
```

实现约束：

- elapsed 只在 component local state，用 `setInterval` 异步 tick。
- 不在 effect body 同步 `setState`。
- active fact 消失时自然 unmount，不需要写 cleanup 状态回 runtime。

### Phase 4：Final Answer Handoff

当 final answer 开始 streaming，前面的 activity 不应该继续像“还在工作”。目标是把体验从 process 切到 answer：

- 如果前面有 activity group，collapsed header 显示“已执行 N 个步骤”或 latest completed tool。
- 正在 streaming 的 assistant text 自己作为主反馈，不再额外显示 “正在回答” 大行。
- 如果 answer 迟迟没有文本，但有 completed tools，则保留一个紧凑 “正在整理答案” row。

实现入口：

- `MessageTurnView` 的 `AssistantBlock` 已经知道 `isLastAssistant` 和 `isLoading`。
- active status 判断不再只看 `assistantEntries.length === 0`，而是从 `activeToolCalls / pendingApproval / toolExecutions / streamingAssistantId` 共同派生。

## 推荐落地顺序

1. **P0：统一 active status view。** 用 `ActiveTurnStatusRow` 承载首 token 前和运行中的当前步骤文案。
2. **P1：增强 activity group header。** 将 `arguments_streaming / running / waiting_result / approval` 显示成明确当前步骤。
3. **P2：长等待升级。** 3s 后显示 elapsed 和更具体 detail。
4. **P3：final handoff。** answer streaming 开始后，activity group 自动收束，不抢主回答。

## 不做的事

- 不新增 core runtime loading state。
- 不创建假的 assistant persisted message。
- 不在 `LauncherAiPage` 或 composer 里补一套 message waiting UI。
- 不用 toast 表示正常等待。
- 不为了未知失败加自动 retry；失败要暴露和排查根因。

## 代码改动点

| 改动                     | 文件                                                                  | 说明                                                           |
| ------------------------ | --------------------------------------------------------------------- | -------------------------------------------------------------- |
| active status projection | `MessageTurnView.tsx` 或 `message-projection.ts`                      | 从 active turn facts 派生 status label/detail/state            |
| status row component     | `MessageTurnView.tsx`                                                 | 渲染 active turn status row                                    |
| group header state       | `MessageTurnView.tsx` 的 `AgentActivityGroup`                         | 用 action status 决定 header title/detail/meta                 |
| reusable status text     | `src/renderer/src/lib/i18n/messages.ts`                               | 新增 “正在理解请求 / 正在准备工具 / 正在整理答案 / 等待你确认” |
| motion reuse             | `TextShimmer.tsx`、`Tool.tsx`、`index.css`                            | 继续复用现有 shimmer/collapsible/reduced-motion                |
| tests                    | `tests/node/message-projection.test.ts`、必要时补 renderer-light test | 覆盖 active status projection，并确认 active tool 不生成临时工具组 |

## 验收场景

1. 发送消息后，assistant 首 token 前 100ms 内当前 turn 出现状态行。
2. 如果 800ms 内没有 token，状态行仍然稳定，不闪烁、不跳动。
3. tool args streaming 时，用户能看到“正在准备工具”的明确状态；具体工具名/detail 仍等正式 tool row 出现后展示。
4. tool running 超过 3s 时，用户能看到 elapsed 或具体 tool detail。
5. HITL approval 出现时，状态从 running 切到 waiting-for-user，不继续 shimmer。
6. final answer streaming 开始后，主注意力回到 answer text，activity 变成辅助信息。
7. reduced motion 下，无 shimmer/展开动画，但状态文案仍可读。
8. 流式 token 更新不刷新整棵 launcher；仍只影响当前 turn/tool row。

## 验证命令

```bash
npm run test:node:target -- tests/node/agent-thread-runtime.test.ts tests/node/agent-thread-runner.test.ts tests/node/message-projection.test.ts tests/node/thread-store-core.test.ts tests/node/agent-run-bootstrap.test.ts tests/node/thread-view.test.ts
npm run check:guardrails
npm run typecheck
```

如果实现到 UI 层，再补一次真实 Electron / CDP 观察：

```bash
OPENWORK_REMOTE_DEBUGGING_PORT=9333 npm run dev
npm run ui-audit:launcher
```

重点看 active turn 是否一直有局部状态反馈，以及 long thread 中 completed activity 是否不会淹没最终答案。
