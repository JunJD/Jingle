# DeerFlow Reference Notes

## Product Memo

### Product

`openwork` 不该被定义成“更强的 coding agent”，而应该被定义成：

`一个把工作交给智能体，但始终保留控制面、审计面、回退面的超级智能助手。`

如果这个定义成立，那么：

- `launcher` 只是入口
- `agent runtime` 只是执行脑
- `harness` 不是内部实现细节，而是用户能直接感受到的产品能力

### User

- 不是只写代码的人
- 而是任何把真实工作交给助手执行的人
- 他们需要的不是“更会做”，而是“做了什么、现在到哪、哪里能接管、错了怎么撤回”

### Pain

今天大多数 agent 产品的问题，不是能力不足，而是工作一旦交出去，就变成黑箱：

- 看不清当前到底在执行什么
- 不知道哪些产物是中间态，哪些可以采用
- 不能稳定暂停、审核、接管
- 出错后只能重跑，不能基于明确状态回退
- 很难把 agent 从“对话工具”变成“工作系统”

### Non-goal

这不是要做：

- 一个通用 agent 平台
- 一个更花哨的 coding agent IDE
- 一个把所有能力都塞进 launcher 的桌面壳

## Hero Workflow

要证明 `openwork` 值得存在，核心工作流应该是：

1. 用户从 launcher 或主工作台提交一个真实工作目标。
2. 系统把这次执行创建成一个可追踪的工作单元。
3. 智能体开始推进，持续产出计划、子任务、文件、结论、审批点。
4. 用户随时能看到：
   - 现在在做什么
   - 已产生了什么
   - 哪一步需要审核
   - 如果不满意，能从哪里回退
5. 最终留下一个可检查、可比较、可复用、可重放的工作记录，而不是一串聊天气泡。

这才是 `human on the loop` 在工作场景里的产品化落点。  
不是把人从审批按钮前移到旁观席，而是让人拥有一个稳定控制面。

## Must-Own Seam

`openwork` 必须自己拥有的，不是“模型调用”，而是：

`把一次 agent 执行收口成一个受控工作单元的能力。`

这个工作单元至少要有：

- 输入
- 环境
- 执行轨迹
- 子任务状态
- 产物列表
- 审批节点
- 检查点
- 回退语义

如果这层不成立，所谓“超级智能助手”就还是一个强一点的聊天工具。

## DeerFlow 真正值得学的部分

`DeerFlow` 最值得学的，不是它用了多少 subagent，也不是它的 web chat 外观。  
真正有价值的是：它已经把 agent 执行的一部分，做成了可管理的控制面原语。

### 1. 它把 thread 当成工作单元，而不是只当会话容器

`../deer-flow/backend/packages/harness/deerflow/agents/thread_state.py` 里，`ThreadState` 不是只有 `messages`，还挂了：

- `thread_data`
- `artifacts`
- `todos`
- `uploaded_files`
- `viewed_images`

这件事非常重要。  
它说明 DeerFlow 已经在做一件对的事：

`一次执行不只是消息流，而是一个带结构化工作状态的单元。`

对 `openwork` 的启发：

- thread / run 必须承载结构化工作状态
- 不能把 todo、artifact、approval、attachment 继续散落在各自 UI 组件里
- 这层应该继续被提升成 `work unit projection`

### 2. 它把 thread-local filesystem 做成了 harness 基础设施

`ThreadDataMiddleware` 会给每个 thread 建出：

- `workspace`
- `uploads`
- `outputs`

也就是 `../deer-flow/backend/packages/harness/deerflow/agents/middlewares/thread_data_middleware.py` 里的 thread data 目录模型。

这意味着 DeerFlow 的 agent 不是在抽象世界里“思考”，而是在一个可定位、可隔离、可清理的工作环境里执行。

这对 `openwork` 的价值很大，因为“可审核、可回退”不可能只靠消息历史实现。  
必须先有一个可边界化的工作目录或工作空间语义。

该学的不是目录名字，而是这条原则：

- 每次工作都要有自己的执行空间
- 用户能知道产物属于哪次工作
- 系统能清理、归档、恢复这次工作留下的痕迹

### 3. 它有一个 runtime 之外的 Gateway API，这其实就是 control plane 雏形

DeerFlow 的 Gateway API 管的不只是模型配置，而是：

- uploads
- artifacts
- memory
- skills
- threads cleanup
- agents

也就是 `../deer-flow/backend/app/gateway/routers/*` 这一层。

这里最值得学的，不是 REST 风格，而是分层意识：

- `agent runtime` 负责执行
- `gateway / control plane` 负责管理可见资源和可控能力

这正符合 `openwork` 的方向。  
因为你要做的不是一个更强 agent，而是一个有控制面的超级助手。

所以对 `openwork` 来说，关键不是“是否也做一个 FastAPI gateway”，而是：

`必须把执行面和控制面明确分层。`

例如：

- 执行面：thread / tool / agent / stream
- 控制面：artifacts / approvals / checkpoints / history / rollback / cleanup / publish

### 4. 它已经把“审批点”做成执行流程的一部分，而不是 UI 补丁

`ClarificationMiddleware` 很关键。

它不是前端看到一句“请补充信息”再自己瞎猜怎么处理中断；  
而是在 middleware 层拦截 `ask_clarification`，直接把执行停在一个明确节点。

这说明 DeerFlow 已经有了一个重要产品前提：

`控制点应该先存在于 runtime 语义里，再投影到 UI。`

这对 `openwork` 完全适用。

你要的“可审核、可回退”，本质上都不是 UI 功能，而是 runtime checkpoint 语义：

- 哪里能暂停
- 哪里必须确认
- 继续后状态如何衔接
- 拒绝后留下什么记录

### 5. 它把 todo / subtask / artifact 变成了用户看得见的控制面

DeerFlow 前端值得学的，不是“好看”，而是它把一些内部运行态公开成了用户可消费的工作控制面：

- `todo-list.tsx`
- `messages/subtask-card.tsx`
- `chats/chat-box.tsx`

这三类东西合起来，构成了最基础的“工作可见性”：

- 当前计划是什么
- 子任务推进到了哪
- 产物有哪些

这比单纯把工具调用日志往外抛强很多。  
因为用户要的不是日志，而是控制。

对 `openwork` 的启发是：

- 主工作台应该优先补 `plan / subtask / artifact` 三个稳定投影
- 这些不是 debug 面板
- 它们就是用户感知 harness 的主要界面

### 6. 它已经有了 cleanup、checkpointer、thread deletion 这些“可恢复”基础件

DeerFlow 里能看到几块很关键的基础设施：

- checkpointer provider
- thread cleanup router
- thread-local filesystem deletion
- artifact path resolution

这说明它至少在系统层面承认：

`执行不是瞬时文本流，而是一个需要持久化、恢复、清理的对象。`

这正是 `openwork` 要继续放大的方向。

## DeerFlow 还不够的地方

如果按你的目标来看，DeerFlow 还不是最终答案。  
它给了很多正确结构，但还没有把“工作控制面”做成第一产品。

### 1. 它更像 thread control，不像 work control

DeerFlow 主要围绕 `thread` 组织能力。  
这很好，但还不够。

因为你要的不是“会话可管理”，而是“工作可管理”。

两者差异很大：

- thread 更像对话容器
- work item 更像一个有目标、状态、审计、回退、交付边界的业务单元

`openwork` 后续不能只停在 thread abstraction。  
应该进一步考虑：

- `thread` 是不是只是 work unit 的一种交互面
- 真正的一等对象是不是 `run / task / case / work item`

### 2. 它的 rollback 语义还不够强

DeerFlow 有：

- checkpointer
- cleanup
- artifacts
- thread-local files

但它还不等于真正的“回退能力”。

因为回退至少有三层：

- 对话状态回退
- 产物版本回退
- 工作空间改动回退

DeerFlow 现在更像“可以重新拿到状态”，还不像“可以明确撤销到哪个受信状态”。

这正是 `openwork` 需要超越它的地方。

### 3. 它的审计仍偏开发者视角

DeerFlow 现在的证据分散在：

- message stream
- middleware
- thread-local outputs
- gateway resources

这对工程师够用，但对工作控制面来说还不够。

你要的产品里，审计面应该更像一个统一账本，而不是分散在多个技术层里的事实。

用户真正想看的是：

- 这次工作输入了什么
- 做了哪些关键决策
- 哪些动作改了外部世界
- 哪些产物是最终结果
- 谁确认过
- 如果撤回，会撤回到哪里

### 4. 它的 control point 还不够广

DeerFlow 已经有 clarification / interruption，但还没有充分展开为工作级 control points，例如：

- 对外发送前审核
- 对关键文件覆盖前审核
- 对“发布 / 提交 / 同步”动作设置明确 gate
- 对已有产物进行 adopt / reject / rollback

也就是说，它更像“执行中的中断能力”，还不是“工作的治理面”。

## Openwork 应该怎么借 DeerFlow

### Own

`openwork` 必须自己拥有这几条：

- `work unit` 模型，而不是只停在 thread
- `control plane` 视图，而不是只有聊天界面
- `checkpoint / approval / rollback` 的产品语义
- `artifact / diff / output / publish state` 的统一账本

### Integrate

可以借 DeerFlow 的是：

- thread-local workspace 思路
- middleware checkpoint 思路
- artifacts / uploads / cleanup 的资源分层
- todo / subtask / artifact 的前端投影方式

### Delay

现在不该优先做的：

- DeerFlow 式大而全的 web harness 部署结构
- 为了“平台化”先做一堆 agent gallery / custom agent 管理
- 把 launcher 扩成整个 control plane

### Risk

最大的风险不是实现难，而是产品概念再次变糊：

- 一会儿想做 launcher
- 一会儿想做 coding agent
- 一会儿想做 generic runtime
- 一会儿想做工作控制面

这些不能并列。

如果你的方向是对的，那就应该明确：

`launcher 是入口，主工作台是控制面，runtime 是执行脑，harness 是产品信任层。`

## 建议的产品定义

### Harness Surface The User Can Feel

用户能感知到的 harness，不应该藏在日志和开发者工具里。  
至少要有这几块可见面：

- `Plan`: 当前计划和状态
- `Run Timeline`: 做了什么、何时做的
- `Artifacts`: 产物与中间产物
- `Approvals`: 待确认动作和历史确认记录
- `Checkpoints`: 可以恢复到的状态点
- `Rollback`: 撤回某次采用、发布或改动

如果这几块做不出来，`human on the loop` 就还停留在概念层。

### What To Cut Now

为了保护产品核心，现在应该主动砍掉：

- 把 focus 放在“更强 coding agent UI”上
- 把 DeerFlow 当作 frontend 视觉参考
- 把 launcher 当成主要工作台
- 提前做通用多 agent 平台叙事

## Recommended Direction

`openwork` 应该定义成一个 launcher-first、workspace-controlled 的超级智能助手：用户从 launcher 进入，但真正的产品核心是主工作台里的工作控制面。每一次 agent 执行都必须留下可检查、可审核、可恢复、可回退的工作单元。`

在这个方向下，DeerFlow 最值得学习的不是“它有 subagent”，而是：

- 它把 thread 做成了结构化执行单元
- 它把 workspace / uploads / outputs 做成了 thread-local 资源
- 它把 artifacts / cleanup / memory / skills 提升成 runtime 之外的管理面
- 它把 clarification / todo / subtask 变成了用户可见的流程控制原语

但 `openwork` 不能停在 DeerFlow 这里。  
你真正要补出来的，是 DeerFlow 还没有完整产品化的那一层：

`工作级 control plane + 审计 + checkpoint + rollback`

## Next Experiment

不要先讨论大平台。  
先挑一个真实工作流，把控制面做出来。

推荐只做一个：

`让一次“产出文档 / 网页 / 分析结果”的 agent 任务，天然生成 plan、timeline、artifacts、approval、checkpoint，并支持回退到上一个已确认状态。`

如果这条跑通，`openwork` 的产品核心就成立了。

## 本次查看的 DeerFlow 文件

- `../deer-flow/README.md`
- `../deer-flow/frontend/README.md`
- `../deer-flow/backend/README.md`
- `../deer-flow/backend/packages/harness/deerflow/agents/thread_state.py`
- `../deer-flow/backend/packages/harness/deerflow/agents/middlewares/thread_data_middleware.py`
- `../deer-flow/backend/packages/harness/deerflow/agents/middlewares/clarification_middleware.py`
- `../deer-flow/backend/packages/harness/deerflow/agents/middlewares/todo_middleware.py`
- `../deer-flow/backend/packages/harness/deerflow/tools/builtins/task_tool.py`
- `../deer-flow/backend/app/gateway/routers/artifacts.py`
- `../deer-flow/backend/app/gateway/routers/threads.py`
- `../deer-flow/backend/packages/harness/deerflow/agents/checkpointer/provider.py`
- `../deer-flow/frontend/src/core/threads/types.ts`
- `../deer-flow/frontend/src/core/tasks/types.ts`
- `../deer-flow/frontend/src/components/workspace/chats/chat-box.tsx`
- `../deer-flow/frontend/src/components/workspace/todo-list.tsx`
- `../deer-flow/frontend/src/components/workspace/messages/subtask-card.tsx`
