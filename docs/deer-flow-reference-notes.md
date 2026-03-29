# DeerFlow Reference Notes

## 目的

把 `../deer-flow` 当成 `openwork` 的参考系之一，但先明确边界：

- `Jingle` 主要是 `launcher` 参考
- `DeerFlow` 主要是 `main workspace + agent harness` 参考
- 不把两者混成一个“什么都往 launcher 里塞”的方向

这份文档只记录对 `openwork` 真有参考价值的部分，不做 DeerFlow 全量介绍。

## 一句话判断

`DeerFlow` 不是 launcher 产品，它更像一个带前端工作台的 `super agent harness`。

对 `openwork` 来说，最值得看的不是“搜索框长什么样”，而是：

- thread 如何投影成 `todo / subtask / artifact`
- workspace shell 如何组织聊天区、产物区、agent 区
- runtime 如何把 `sandbox / subagent / memory / skill` 收口在 UI 下层

## DeerFlow 的产品边界

从 `../deer-flow/README.md`、`../deer-flow/frontend/README.md`、`../deer-flow/backend/README.md` 看，DeerFlow 的主线是：

- 前端是一个 web workspace，不是系统级 launcher
- 后端是 `LangGraph Server + Gateway API + sandbox + subagents + memory`
- 会话单位是 `thread`
- thread 上天然挂着 `uploads / artifacts / todos / agent execution`
- skills 和 custom agents 是一等能力，不是补丁

这和 `openwork` 当前 launcher 路线不同。`openwork` 的 launcher 已经明确收口为 `home/search + feature page + typed plugin host`，见 `docs/launcher-shell-architecture.md`。

## 对 openwork 真有价值的点

### 1. 把 thread projection 做成一等层

DeerFlow 前端不是直接拿原始流事件到处渲染，而是把 thread 投影成多个稳定 UI 面：

- `todo-list.tsx`
- `messages/subtask-card.tsx`
- `chats/chat-box.tsx`

这对 `openwork` 的启发是：

- `todo / tool call / approval / artifact / subtask` 应该继续收口到共享 thread projection
- page 只消费投影结果，不直接理解 runtime 细节
- 这条思路和当前 launcher AI 共享 conversation state 的方向是一致的

### 2. Chat + Artifact 分栏很值得借

DeerFlow 的 `chat-box.tsx` 采用聊天区和 artifact 区并排切换的工作台模式。

这适合 `openwork` 的主应用，不适合 launcher：

- 适合主应用里的代码、网页、文档、图表输出
- 不适合 launcher 的快速意图捕获

结论：

- 如果 `openwork` 主 chat 后续强化文件/代码产物，优先参考 DeerFlow 的 artifact side panel
- 不要把 artifact 面板塞进 launcher shell

### 3. Todo / Subtask 可视化比“工具日志列表”更像工作流

DeerFlow 把多步任务显式渲染成：

- 折叠的 todo strip
- 可展开的 subtask card
- 每个 subtask 的状态、最新动作和结果

这比单纯显示工具调用流更适合 `openwork` 想做的“工作感”。  
如果后续要强化 agent orchestration，这部分比 Jingle 更值得抄。

### 4. Agent Gallery 值得参考，但应该落在主工作台

DeerFlow 有独立的 agent gallery：

- `workspace-nav-chat-list.tsx`
- `agents/agent-gallery.tsx`

这说明它把“聊天”和“agent 配置/选择”当成两个平级工作台对象。

对 `openwork` 的意义：

- 未来如果要把 assistant / extension / custom agent 做成可管理实体，应该放进主应用
- 不要先把它做成 launcher 二级页

### 5. Command Palette 是 shell overlay，不是 launcher 替代品

DeerFlow 的 `command-palette.tsx` 做的是应用内动作面板：

- 新建 chat
- 打开 settings
- 查看快捷键

它不是系统级 launcher，也不承担 app search / app launch。

这对 `openwork` 很重要：

- `launcher` 负责桌面级 intent capture
- `command palette` 如果要做，应该是主应用内部 shell action menu
- 两者不要复用同一套心智模型

### 6. Runtime 分层比 UI 长相更值得学

DeerFlow backend 的核心不是界面，而是 runtime 分层：

- `lead agent`
- middleware chain
- sandbox
- subagents
- memory
- gateway API

这套分层给 `openwork` 的启发是：

- UI 不应该直接背负 runtime 复杂性
- `approval / tool execution / thread data / uploads / artifacts` 这些都应该先有后端边界，再投影到 UI
- 我们已有 `execute approval middleware` 与 DeerFlow 接近，见 `docs/execute-approval-middleware.md`

## 不该照搬的点

### 1. 不要把 openwork 改造成 DeerFlow 的部署结构

DeerFlow 是典型 web harness：

- Nginx
- LangGraph server
- Gateway API
- Next.js frontend

`openwork` 是 Electron 桌面应用。除非真有部署压力，否则不要为了“像 DeerFlow”复制它的服务拆分。

### 2. 不要把 launcher 做成 mini workspace

DeerFlow 的强项是 workspace，不是 launcher。

所以：

- artifact
- agent gallery
- 大块 task orchestration UI
- 重型 settings / config surface

都不应该优先往 launcher 放。

### 3. 不要整包照搬 DeerFlow skills / custom agents 体系

DeerFlow 的 skills、custom agents、gateway API、thread-local filesystem 是一整套 harness 设计。

`openwork` 已经有自己的方向：

- launcher plugin host
- assistant / extension 架构
- 本地技能体系

正确做法是借它的边界意识，不是直接复制它的对象模型。

## 对 openwork 的落点建议

### 短期

- 继续强化主 chat 的共享 thread projection
- 优先补 `todo / subtask / artifact` 三种稳定投影
- 如果主应用即将强化代码/网页输出，考虑引入 artifact side panel

### 中期

- 把 assistant / extension registry 往 DeerFlow 的 agent gallery 方向推进
- 明确主应用中的 `thread-local uploads / outputs / artifacts` 模型
- 保持 launcher 只是入口，不承接重型工作台职责

### 参考边界

建议后续统一这样使用参考系：

| 主题 | 更该看谁 | 原因 |
| --- | --- | --- |
| launcher 唤起、app search、空态 history | `Jingle` | 它本来就是 launcher 参考 |
| main workspace、artifact 区、todo/subtask、agent gallery | `DeerFlow` | 它本来就是 workspace/harness 参考 |
| tool approval / interrupt 边界 | `DeerFlow` | runtime 分层更成熟 |
| typed plugin host / Electron desktop integration | `openwork` 自己定义 | 现有边界已经比两边都更贴当前目标 |

## 本次查看的文件

- `../deer-flow/README.md`
- `../deer-flow/frontend/README.md`
- `../deer-flow/backend/README.md`
- `../deer-flow/frontend/src/components/workspace/command-palette.tsx`
- `../deer-flow/frontend/src/components/workspace/chats/chat-box.tsx`
- `../deer-flow/frontend/src/components/workspace/todo-list.tsx`
- `../deer-flow/frontend/src/components/workspace/messages/subtask-card.tsx`
- `../deer-flow/frontend/src/components/workspace/agents/agent-gallery.tsx`
