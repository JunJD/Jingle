# Extension Action Proposal Protocol: WGS 调研与方案

日期：2026-06-14

## 0. 结论

Extension HITL 的核心问题不应该继续定义成“怎么把 tool args 渲染成更好的表单”。表单只是一个局部控件问题，解决的是参数编辑；真正能把 agent 从 coding IDE 带到业务软件里的，是让 extension 把不可穷举的用户意图收敛成有限、可审计、可预览、可合并、可撤销或可补偿的业务操作。

这份方案把这个方向称为 WGS：

```text
无限意图 -> 有限操作
```

Openwork 不应该为 Notion、GitHub、Reminders 这类外部软件写死展示逻辑，也不应该把 schema form 当作 extension HITL 的终局。Openwork 应该拥有一个 Action Proposal Protocol：

```text
user intent
  -> agent resolves extension entities
  -> extension proposes finite domain action
  -> Openwork evaluates policy/risk/conflict/reversibility
  -> Action Canvas previews the operation
  -> only ambiguous, risky, irreversible, external, or conflicting actions enter HITL
  -> runtime commits action and records evidence
```

这会显著减少 HITL，因为 HITL 不再围绕每个 tool call 出现，而只围绕需要人类判断的业务操作出现。

## 1. ADR summary

Status: proposed.

Decision:

- Adopt Extension Action Proposal Protocol as the long-term extension HITL direction.
- Treat schema form as an editable input renderer inside Action Canvas, not as the protocol.
- Let extension packages declare domain entities/actions/previews/policy hints.
- Let Openwork own runtime policy, HITL interrupt/resume, durable review payload, generic Action Canvas, evidence, and audit.
- Keep V0 on top of existing `ToolApprovalMiddleware` and `pendingApproval.review`; do not create a parallel approval runtime.

Rejected alternatives:

| Alternative | Why rejected |
|---|---|
| Keep improving simple/large approval cards only | Improves visual clarity but does not reduce HITL or create business operation semantics |
| Build a generic schema form as the main solution | Solves field editing, but not entity identity, preview, policy, merge, inverse, evidence |
| Hardcode Notion/GitHub/Reminders renderers | Short-term pretty, long-term violates extension boundary and does not scale to third-party packages |
| Adopt MCP/Bedrock as the whole protocol | Useful tool/action layers, but not enough for desktop extension HITL, local evidence, and business delta governance |
| Let extension ship arbitrary HITL React UI in V1 | Too much trust and boundary surface; makes policy/audit harder and risks renderer coupling |

Architectural bet:

```text
assistant-core maps intent
extension declares finite business operations
Openwork governs proposals
renderer presents proposals
```

This keeps Openwork assistant-first while letting extensions be integration shells around domain operations.

## 2. 为什么不是 schema form

当前我们讨论过 “simple card / large card / future schema form”。这个分层对 UI 实现有用，但它不是产品本质。

Schema form 能回答：

- 这个字段是文本、日期、下拉还是多选？
- 字段之间是否有条件显示？
- 用户能否在批准前修一个参数？

但它不能回答：

- 这个动作到底改变了哪个业务实体？
- 这个动作能不能撤销？
- 如果用户和 agent 同时改了同一对象，如何合并或冲突？
- 哪些动作可以自动执行，哪些必须请求确认？
- 一组底层 API 调用是否应折叠成一个业务动作？
- 用户看到的是“工具参数”，还是“将要发生的业务变化”？

所以 schema form 应该被降级为 Action Canvas 里的一个参数编辑器，而不是 extension HITL 的协议核心。

## 3. 外部调研

### 3.1 SPDD：prompt 作为一等工件，但还不是业务操作协议

[Structured-Prompt-Driven Development](https://martinfowler.com/articles/structured-prompt-driven/) 的关键启发是：prompt 不应该只是一次性自然语言输入，而应该成为可版本化、可审查、可治理的结构化工件。它把需求、抽象、设计决策和生成约束收束在同一个 artifact 中。

对应到 Openwork：

- 业务意图也需要一等工件。
- 这个工件不能只是 chat history。
- 对 extension 来说，这个工件应该是 Action Proposal：一个可展示、可审计、可执行、可恢复的业务操作提案。

SPDD 解决的是“如何把自然语言开发需求结构化”；Openwork 需要解决的是“如何把自然语言业务意图结构化成有限操作”。

### 3.2 Amazon Canvas：不是表单，而是行动工作台

[Amazon Canvas](https://www.aboutamazon.com/news/innovation-at-amazon/amazon-sellers-canvas-artificial-intelligence) 把 AI chat、业务数据、动态视觉和关键行动放在同一个 canvas 中。卖家不是在审批一个 API 调用，而是在一个业务上下文里看推荐、看影响、追问、调整、执行动作。

这个方向和 Openwork extension HITL 很接近：

- 不是 “Approve / Reject a tool call”。
- 不是 “Fill a form”。
- 而是 “Review an action in its business context”。

Amazon Canvas 的产品启发是：agent 做业务动作时，交互界面应该围绕业务对象、影响和下一步行动组织，而不是围绕工具名称和 JSON 参数组织。

### 3.3 Apple App Intents：最接近的系统级先例

[Apple App Intents](https://developer.apple.com/documentation/appintents) 让 app 通过结构化声明把 action 和 data 暴露给系统，用于 Siri、Shortcuts、Spotlight、widgets、Apple Intelligence 等入口。它的核心概念包括：

- `AppIntent`：声明 app 能执行的动作。
- `@Parameter`：声明动作需要的参数。
- `AppEntity`：声明 app 内的实体概念。
- `EntityQuery`：让系统按 identifier 或建议列表解析实体。
- `requestConfirmation` / `requestChoice`：在需要时向用户确认或选择。

这是非常重要的参考，因为它已经证明了一个方向：外部软件可以把自己的实体和动作声明给系统，让系统在 app 外部调用。

但 Openwork 还需要补齐 Apple App Intents 没有直接覆盖的 agent 工作流语义：

- action proposal preview
- policy/risk evaluation
- reversible / inverse / compensation
- merge/conflict semantics
- execution evidence
- agent checkpoint/resume
- extension installable package boundary

也就是说，App Intents 是 “app actions for system surfaces”；Openwork 需要的是 “business action proposals for autonomous agents”。

### 3.4 MCP 与 Bedrock Agents：工具层，不是治理层

[MCP tools](https://modelcontextprotocol.io/specification/2025-06-18/server/tools) 已经提供 `inputSchema` / `outputSchema`，并要求客户端在敏感操作上提示用户确认、展示工具输入、验证结果、记录使用情况。它适合做工具互操作协议。

[Amazon Bedrock Agents action groups](https://docs.aws.amazon.com/bedrock/latest/userguide/agents-action-create.html) 把 agent 能帮助用户执行的动作组织成 action group，并定义参数、elicitation 和 fulfillment。

这些方案证明了“工具和动作需要结构化”，但它们仍主要停在调用层：

```text
agent chooses tool/action
  -> schema validates input
  -> runtime invokes implementation
```

Openwork extension 需要再往上走一层：

```text
agent chooses business operation
  -> extension resolves entity and produces preview
  -> platform evaluates risk/policy/conflict
  -> user only reviews meaningful business delta
  -> runtime commits and records evidence
```

### 3.5 JSON Forms / RJSF：适合参数编辑，不适合定义操作世界

[JSON Forms rules](https://jsonforms.io/docs/uischema/rules/) 支持根据数据条件隐藏、显示、启用、禁用 UI 元素。[react-jsonschema-form dependencies](https://rjsf-team.github.io/react-jsonschema-form/docs/json-schema/dependencies/) 支持字段依赖、条件 schema 和 follow-up questions。

这些库可以作为 Action Canvas 里的默认参数编辑器参考，尤其是：

- 文本、日期、下拉、多选、开关等控件。
- 条件字段和联动。
- schema validation。

但它们不负责：

- entity resolution
- business preview
- merge/conflict
- permission policy
- inverse/compensation
- audit evidence

所以它们是 implementation option，不是 product architecture。

### 3.6 协同编辑 transaction：有限操作为什么能解决协同

协同文档能工作，不是因为它理解了所有自然语言意图，而是因为它把无限编辑意图压成有限的 document steps / operations，并为这些 operation 定义了可重放、可映射、可反转、可合并或可冲突处理的规则。

[ProseMirror transform guide](https://prosemirror.net/docs/guide/) 的关键思想是：文档修改由一组可记录、可重放的 steps 构成；这些 steps 是 transaction、undo history 和 collaborative editing 的基础。

这正是 WGS 对业务软件的启发：

```text
人和人协同文档:
  无限编辑意图 -> 有限文档操作 -> transform/merge/invert

agent 和人协同业务软件:
  无限业务意图 -> 有限业务操作 -> preview/policy/merge/inverse/evidence
```

这不是把 CRDT/OT 生搬硬套到所有软件，而是借用它的抽象：先把世界压成有限操作，再讨论协同、审计和自动化。

## 4. Openwork 当前事实

### 4.1 当前 extension tool contract

当前 `ExtensionToolDefinition` 的核心字段是：

```ts
interface ExtensionToolDefinition<TInput = unknown, TOutput = unknown> {
  access: "read" | "write" | "external"
  approval?: {
    confirmation?: (input, context) => ExtensionToolConfirmation
    riskLabel?: "write" | "external" | "destructive"
  }
  description: string
  inputSchema: ExtensionToolSchema<TInput>
  name: string
  outputSchema?: ExtensionToolSchema<TOutput>
  title: string
  handler(ctx, input): Promise<TOutput> | TOutput
}
```

这个 contract 适合表达 “一个工具怎么被调用”。它还不能表达 “一个业务操作如何被治理”。

### 4.2 当前 approval gate

当前权限模型主要由 `permissionMode + access` 决定：

| mode | read | write / external |
|---|---|---|
| explore | allow | deny |
| ask-to-edit | allow | require approval |
| auto | allow | allow |

这保证了平台安全底线，但粒度太粗：

- 同样是 `write`，创建草稿、创建公开 issue、删除提醒、发邮件、付款不是同一风险等级。
- 同样是 `external`，打开 URL、打开系统 app、发起公开发布也不是同一风险等级。
- 低风险、可逆、目标明确的动作不应该总是 HITL。
- 高风险、不可逆、跨边界传播的动作即使在 auto mode 也可能需要确认。

### 4.3 当前 Notion 展示为什么看起来更标准

Notion 的 `createDatabasePage` 之所以能显示 `Title / Content / In data source`，不是因为 Openwork 已经有 schema form 或 action protocol，而是 Notion extension 手写了 `approval.confirmation.info`。

GitHub `createIssue` 和 Apple Reminders 的 create/complete/delete/open 当前没有等价的 confirmation facts，所以它们不会自然获得同样的业务展示质量。

这说明现在的系统有一个展示 hook，但还没有一个领域动作标准。

## 5. 设计目标

### 5.1 产品目标

Openwork extension 应该从 “tool provider” 升级成 “domain operation provider”。

一个 extension 不只是提供 API wrapper，而是声明一组业务实体和有限操作：

```text
Notion:
  Entity: database, page, block
  Action: create page, append block, update property

GitHub:
  Entity: repository, issue, pull request, label
  Action: create issue, comment, add label, close issue

Apple Reminders:
  Entity: list, reminder
  Action: create reminder, complete reminder, delete reminder, open reminder
```

Agent 可以理解无限自然语言，但落地执行时必须收束到这些有限操作上。

### 5.2 工程边界

Openwork owns:

- protocol version
- action registry loading
- permission and policy evaluation
- HITL interrupt/resume
- Action Canvas generic renderer
- checkpoint and durable action state
- execution evidence and audit trail
- default schema-field renderer

Extension owns:

- domain entity definitions
- entity queries and resolvers
- action definitions
- action-specific preview
- business preconditions
- risk hints and reversibility hints
- commit implementation
- optional inverse/compensation
- optional merge/conflict hints

Renderer owns:

- pure view projection
- local UI state such as expanded sections, selected choice, draft field edits
- no business policy authority
- no hidden fallback from missing protocol into guessed semantics

Runtime owns:

- stable work facts
- action proposal lifecycle
- decision persistence
- commit result persistence
- failure semantics

## 6. Action Proposal Protocol

### 6.1 Entity

Entity 是 extension 暴露给 agent 和 Action Canvas 的业务对象类型。

```ts
interface ExtensionEntityDefinition {
  type: string
  title: string
  description?: string
  idSchema: ExtensionToolSchema
  display(entityRef: ExtensionEntityRef): Promise<EntityDisplay>
  query?: ExtensionEntityQueryDefinition
  relations?: ExtensionEntityRelationDefinition[]
}

interface ExtensionEntityRef {
  extensionName: string
  type: string
  id: string
  label?: string
  url?: string
}
```

Entity 的关键不是“字段很多”，而是让 agent 和平台能稳定指向一个业务对象。没有稳定 entity identity，就无法做 preview、conflict、undo、audit。

### 6.2 Action

Action 是 extension 声明的有限业务操作。

```ts
interface ExtensionActionDefinition<TInput = unknown, TPreview = unknown, TResult = unknown> {
  id: string
  title: string
  description: string
  operation: "create" | "update" | "delete" | "complete" | "open" | "publish" | "comment" | "custom"
  target?: {
    entityType: string
    required: boolean
  }
  inputSchema: ExtensionToolSchema<TInput>
  preview(ctx: ExtensionActionContext, input: TInput): Promise<ActionPreview<TPreview>>
  policy?: ExtensionActionPolicyHint
  commit(ctx: ExtensionActionContext, proposal: ActionProposal<TInput, TPreview>): Promise<TResult>
  inverse?: ExtensionActionInverseDefinition<TResult>
  merge?: ExtensionActionMergeDefinition<TPreview>
}
```

Action 和 tool 的差别：

- tool 关心 handler 怎么跑。
- action 关心业务世界将如何变化。

### 6.3 Action Proposal

Action Proposal 是 agent 准备执行前生成的业务操作提案。

```ts
interface ActionProposal<TInput = unknown, TPreview = unknown> {
  id: string
  protocolVersion: 1
  extensionName: string
  actionId: string
  title: string
  target?: ExtensionEntityRef
  input: TInput
  preview: ActionPreview<TPreview>
  policy: ActionPolicyEvaluation
  confidence: ActionConfidence
  evidence: ActionEvidence[]
  createdAt: string
}
```

Proposal 是 HITL 的核心 payload。用户不应该审批一个 raw tool call，而应该审阅一个 proposal。

### 6.4 Preview

Preview 不是文案模板，而是业务 delta。

```ts
interface ActionPreview<TData = unknown> {
  summary: string
  facts: ActionPreviewFact[]
  effects: ActionEffect[]
  before?: unknown
  after?: unknown
  data?: TData
}

interface ActionEffect {
  kind: "create" | "update" | "delete" | "external" | "notify" | "publish" | "custom"
  entity?: ExtensionEntityRef
  label: string
  detail?: string
}
```

Notion 当前的 `Title / Content / In data source` 可以迁移为 `preview.facts`。GitHub issue 当前可以展示 repository、title、body、visibility；labels、assignees、milestone 等字段只有在后续 tool schema 增加后才进入 proposal。Reminders 可以展示 list、title、due date、priority、notes。

### 6.5 Policy

Policy 不应该只看 `access`。它应该看 action proposal 的业务属性。

```ts
interface ActionPolicyEvaluation {
  disposition: "allow" | "require_approval" | "deny" | "require_clarification"
  reason: string
  risk: "low" | "medium" | "high" | "destructive"
  reversible: boolean
  externalVisibility: "private" | "workspace" | "public" | "system" | "unknown"
  targetConfidence: "high" | "medium" | "low"
  conflicts: ActionConflict[]
}
```

建议的默认规则：

| 条件 | 默认结果 |
|---|---|
| read/query/resolve | allow |
| 目标不明确 | require clarification |
| 低风险、私有、可逆、目标置信度高 | allow in auto mode |
| 低风险、私有、可逆、ask-to-edit mode | require approval |
| 公开发布、通知他人、跨系统外发 | require approval |
| destructive 或不可逆删除 | require approval 或 deny |
| 缺少 auth scope / permission | deny |
| preview 与最新 entity state 冲突 | require approval 或 require clarification |

这里的重点不是一次性把矩阵做完，而是让 policy 的输入从 `tool access` 升级成 `business action facts`。

### 6.6 Inverse / Compensation / Merge

不是所有业务软件都能做真正 undo，所以协议应该区分三类能力：

| 能力 | 语义 | 例子 |
|---|---|---|
| inverse | 可直接反向应用 | complete reminder -> uncomplete reminder |
| compensation | 不能撤销，但能补偿 | posted comment -> add correction comment |
| none | 不可逆 | permanently delete, send external message |

Merge 也不应该一开始追求通用 CRDT。V1 只需要支持 extension 声明简单冲突规则：

- proposal 基于哪个 entity version / updatedAt / etag 生成。
- commit 前是否需要重新读取 target。
- 如果字段被别人改了，是自动合并、重新 preview，还是要求用户确认。

这会把“协同文档算法”的精髓拿过来，但不会把 Openwork 变成通用 workflow/CRDT 引擎。

### 6.7 Evidence

Action commit 后必须留下证据。

```ts
interface ActionEvidence {
  kind: "entity" | "link" | "artifact" | "message" | "log"
  title: string
  url?: string
  entity?: ExtensionEntityRef
  text?: string
}
```

Evidence 的作用：

- 用户能检查结果。
- Agent 后续能引用刚刚创建或修改的对象。
- 审计和回放有稳定事实。
- 失败排查时不需要从 UI 文案反推发生了什么。

## 7. Action Canvas 体验

Action Canvas 是 proposal 的产品表面，不是一个普通表单。

一个高质量 Action Canvas 应该展示：

```text
Action title
Target entity
What will change
Important fields
Risk / reversibility / visibility
Conflicts or missing choices
Evidence after commit
Primary action: commit
Secondary actions: edit / choose target / ask agent to revise / reject
```

Raycast 的 tool HITL 看起来舒服，是因为它把业务事实放到了用户看得懂的位置：Create Page、Title、Content、In Database。Openwork 要更进一步，把这些从“手写展示”提升为“extension 声明的 action proposal”。

Schema form 在这里的位置是：

```text
Action Canvas
  - preview facts
  - effects
  - risk
  - target
  - editable input fields (schema form)
  - decisions
```

所以 form 是 canvas 的一个区域，不是 canvas 本身。

### 7.1 Raycast HITL 对比

Raycast 的当前优势是：审批卡里已经出现业务事实，而不是纯 JSON。图里的 Notion 示例让用户看到 `Create Page`、`Title`、`Content`、`In Database`，所以它比 raw tool args 更接近“我知道 agent 要做什么”。

但 Raycast 风格还不是 Openwork 的终局：

| Raycast-style HITL | Openwork Action Canvas |
|---|---|
| 以 tool confirmation 为中心 | 以 business action proposal 为中心 |
| 展示若干字段 | 展示 target、delta、risk、visibility、reversibility、evidence |
| approve/reject 是主要动作 | commit/clarify/edit/reject 是可能动作，但 V0 仍可只做 approve/reject |
| tool author 手写展示 | extension 声明 action proposal，平台统一渲染 |
| 对单次 tool call 友好 | 可把多个底层 API 调用折成一个业务动作 |

Openwork V0 不需要一下做得比 Raycast 花哨，但它必须在信息架构上比 Raycast 更稳：用户审阅的是 action，不是参数。

### 7.2 Action Canvas information architecture

V0 的 Action Canvas 应该按这个顺序组织：

1. **Action line**：一句话说清业务动作，例如 `Create a Notion page in Post`。
2. **Target**：被作用的实体，例如 repository、Notion data source、reminder list。
3. **Delta**：将发生的变化，例如 create issue、delete reminder、append blocks。
4. **Key facts**：用户判断所需字段，例如 title/content/body/due date。
5. **Risk strip**：risk、visibility、reversible、target confidence。
6. **Evidence placeholder**：成功后会产生什么，例如 page link、issue URL、reminder id。
7. **Debug/raw details**：折叠区，供排查，不做主视觉。

现有 large approval view model 已经有 `confirmation / target / impact / parameters`。Action Canvas V0 可以沿用这套结构，但语义要调整：

| 现有 large approval | Action Canvas V0 |
|---|---|
| `confirmation.message/title` | action line / summary |
| `confirmation.facts` | key facts |
| `target` | target entity |
| `impact` | delta / effects / risk reason |
| `parameters` | editable/debug fields，不能抢主视觉 |

### 7.3 Desktop interaction rules

遵循桌面命令工具的微交互原则：

- Feedback 要贴近 proposal 卡，不要用全局 toast 代替审批状态。
- 批准/拒绝后 100-200ms 内给本地按下/提交反馈，但不要本地清空 pending approval；必须等 runtime `approval.cleared`。
- 高风险动作的视觉强度应该来自 risk strip 和 effect tone，而不是大红整卡。
- 键盘路径必须稳定：primary action 固定在 footer，secondary action 固定位置。
- 展开/折叠 raw details 不应改变主要信息的阅读顺序。
- 成功结果如果有 link/artifact，应该在 tool result/evidence 里出现，不再 toast 重复叙述。
- reduced motion 下仍要保留状态变化含义。

### 7.4 V0 visual acceptance

V0 UI 验收：

- Notion create page 首屏能看到 title、content 摘要、data source。
- GitHub create issue 首屏能看到 repository、title、body 摘要、public/shared 风险。
- Apple Reminders create 首屏能看到 title、list、due date、priority，并呈现 low/private/reversible。
- Apple Reminders delete 首屏能看到 reminder title，并呈现 destructive/not reversible。
- Raw args 不出现在主视觉里，除非 proposal 缺失。
- 不出现 Notion/GitHub/Reminders 专用 renderer 分支。
- Approval card 属于 owning turn；切换/恢复线程后仍从 `review_payload` 还原。

## 8. HITL 如何显著减少

### 8.1 从工具审批变成动作治理

当前链路：

```text
每次 write/external tool call
  -> ask-to-edit mode 下大概率 HITL
```

目标链路：

```text
每个业务 action proposal
  -> policy 判断是否真的需要人
```

这会减少几类不必要 HITL：

1. Read/search/resolve 不确认。
2. 低风险可逆动作在用户允许的模式下自动执行。
3. 多个底层 API 调用折叠成一个业务动作。
4. 目标不明确时走 clarification，而不是 approval。
5. 用户已经批准的 proposal 内部重试或补充查询不再次打断。
6. 相同 action pattern 在同一 trust scope 内可以形成短期授权。

### 8.2 HITL 只处理人类判断

应该进入 HITL 的情况：

- 公开发布。
- 通知他人。
- 删除或不可逆动作。
- 金钱、权限、安全边界。
- extension 标记 high risk。
- target confidence 低。
- preview 与当前 entity state 冲突。
- action 会跨出当前 workspace/private scope。

不应该进入 HITL 的情况：

- 参数可以由 schema 自动校验。
- 信息缺失但可以通过 entity query 获取。
- 低风险、可逆、私有的日常动作。
- handler 内部需要多次 API 调用。
- UI 不知道怎么展示，所以退回人工审批。

### 8.3 为什么这会显著减少 HITL

减少 HITL 的关键不是“把确认卡做得更漂亮”，而是改变系统判断单位。

工具级 HITL 的判断单位是：

```text
will this tool call write or call external software?
```

Action Proposal 的判断单位是：

```text
is this business delta risky, ambiguous, irreversible, externally visible, or conflicting?
```

这会带来四个结构性变化：

| 变化 | 工具级 HITL | Action Proposal HITL |
|---|---|---|
| 信息收集 | 可能被误当成工具风险 | 永远不审批，只记录查询 |
| 目标不清 | 常被包装成确认卡 | clarification，不是 approval |
| 多 API 调用 | 每次 write 都可能打断 | 一个业务动作只审批一次 |
| 低风险动作 | ask-to-edit 下仍频繁打断 | auto mode 下可按 policy 自动提交 |

也就是说，HITL 从“每次外部写入都问一下”变成“只有人类判断不可替代时才问”。这不是一个 UI 优化，而是一个治理模型变化。

### 8.4 最小判定模型

V1 可以先用一个保守的 policy decision，而不是引入复杂规则引擎：

```ts
type ActionDecision =
  | { disposition: "allow" }
  | { disposition: "require_approval"; reason: string }
  | { disposition: "require_clarification"; reason: string }
  | { disposition: "deny"; reason: string }

function decideActionProposal(
  proposal: ExtensionActionProposal,
  mode: "ask-to-edit" | "auto",
): ActionDecision {
  if (proposal.policy.targetConfidence !== "high") {
    return {
      disposition: "require_clarification",
      reason: "The target entity is not clear enough.",
    }
  }

  if (proposal.policy.conflicts?.length) {
    return {
      disposition: "require_approval",
      reason: "The target changed after the proposal was prepared.",
    }
  }

  if (proposal.policy.risk === "high" || proposal.policy.destructive) {
    return {
      disposition: "require_approval",
      reason: "This action is high risk or destructive.",
    }
  }

  if (proposal.policy.externalVisibility !== "private") {
    return {
      disposition: "require_approval",
      reason: "This action may be visible outside the private workspace.",
    }
  }

  if (!proposal.policy.reversible && !proposal.policy.compensatable) {
    return {
      disposition: "require_approval",
      reason: "This action cannot be reversed or compensated.",
    }
  }

  if (mode === "ask-to-edit") {
    return {
      disposition: "require_approval",
      reason: "Ask to Edit mode requires approval for write actions.",
    }
  }

  return { disposition: "allow" }
}
```

这个模型故意保守：它只自动放行 `targetConfidence=high`、低风险、私有、可逆或可补偿、无冲突，并且当前模式允许自动执行的 proposal。

### 8.5 减少 HITL 的例子

以“调研最新 AI 资讯写入 Notion”为例，工具级流程容易变成：

```text
search web
get Notion databases
query database
create page
append blocks
maybe update properties
```

Action Proposal 流程应该变成：

```text
read/search/resolve steps
  -> no approval

one Create Database Page proposal
  -> approve once in ask-to-edit mode
  -> maybe auto in auto mode if policy allows

commit result evidence
  -> created page link
```

以 Apple Reminders 为例：

| User intent | Action | Expected HITL |
|---|---|---|
| “明早提醒我带证件” | create reminder | auto in auto mode |
| “把这个提醒标记完成” | complete reminder | auto in auto mode |
| “删掉所有过期提醒” | batch delete reminders | require approval |
| “给项目 A 建 5 个待办” | create reminders batch | one batch proposal, not 5 approvals |

以 GitHub 为例：

| User intent | Action | Expected HITL |
|---|---|---|
| “看看有哪些 open bug” | list/search issues | no approval |
| “给这个 bug 加 label” | add label | maybe auto if private/trusted repo policy allows |
| “发一个 public issue” | create issue | require approval because externally visible |
| “close 这些 issue” | batch close | one approval with target list and effects |

所以 WGS 真正减少 HITL 的地方，是把不可穷举的自然语言需求先压缩成有限 action，再让 policy 对 action 做判断。没有 action 层，系统只能按 tool/write/external 粗粒度打断；有 action 层，系统才知道哪些事情其实不需要问人。

## 9. 现成方案选型

没有一个现成方案能直接覆盖 Openwork 需要的完整层次。正确做法不是“选一个 schema form 库”，而是分层复用。

| 方案 | 能解决什么 | 不能解决什么 | Openwork 建议 |
|---|---|---|---|
| Apple App Intents | app 声明 actions、entities、queries，并把能力暴露给系统入口 | 不提供 agent proposal policy、preview、merge、evidence，也不是 JS/Electron extension runtime | 作为最重要的产品和协议参考 |
| MCP tools | tool discovery、input/output schema、structured result、安全提示 | 不定义业务实体、action canvas、inverse/merge、平台 policy | 作为互操作和 tool envelope 参考，不作为 HITL 产品层 |
| Bedrock Agents action groups | action group、参数 elicitation、fulfillment | 绑定 AWS agent 编排，不提供桌面 extension UI 或本地 evidence contract | 参考 action grouping 和参数收集，不引入 |
| LangGraph interrupt | durable pause/resume、HITL payload、checkpoint | 不定义 payload 的业务语义 | 继续作为 Openwork runtime 暂停机制 |
| CopilotKit HITL / generative UI | tool rendering、graph-paused HITL、前端协作模式 | 偏 web app stack，不解决 Openwork extension contract | 借鉴交互模式，不引入 runtime |
| JSON Forms / RJSF | JSON Schema 表单、字段依赖、条件显示、枚举和动态 follow-up | 不懂业务实体、preview、policy、audit | 只作为后续 editable input renderer 候选 |
| ProseMirror / CRDT/OT | 有限 operation、transaction、replay、invert、collaboration 思想 | 领域限定在文档，不能直接套业务软件 | 借鉴“有限操作 + 合并规则”思想 |
| Temporal / Saga | durable workflow、activity retry、compensation pattern | 对 Openwork V1 太重，不是 extension HITL UI 协议 | 借鉴 compensation 语义，不引入 |

### 9.1 当前依赖事实

Openwork 现在没有引入 JSON Forms、RJSF、Formily、uniforms、react-hook-form 这类表单库。当前可用基础是：

- renderer 已有 Radix primitives。
- extension runtime SDK 已有 `Form.TextField`、`Form.TextArea`、`Form.Checkbox`、`Form.DatePicker`、`Form.Dropdown`、`Form.TagPicker`、`Form.Message`、`Form.Description`。
- approval confirmation 已有 facts/info 展示 hook。

所以 V0 不应该先加一个重表单库。应该先定义 action proposal contract 和 Action Canvas view model，再用现有控件覆盖最小字段编辑。

引入表单库的条件应该是：

1. action proposal 协议已经稳定。
2. 至少三个 extension 的 editable input 都需要条件字段或复杂数组对象。
3. 现有 Radix/SDK primitives 已经产生明显重复实现。
4. 表单库不会反向污染 extension action protocol。

### 9.2 下拉、联动与 entity query

下拉和联动不应该由 renderer 猜，也不应该允许 extension 在 approval renderer 里执行任意 React/JS 逻辑。更稳的边界是把 choices 和 rules 放进 action input schema 的受控扩展里。

```ts
interface ActionInputChoiceSource {
  kind: "static" | "entity_query" | "remote_search"
  entityType?: string
  options?: Array<{ label: string; value: string }>
}

interface ActionInputRule {
  effect: "show" | "hide" | "enable" | "disable" | "require"
  when: {
    field: string
    equals?: unknown
    includes?: unknown
    exists?: boolean
  }
}
```

建议分期：

| 能力 | V0 | V1 | V2 |
|---|---|---|---|
| static enum | 支持 | 支持 | 支持 |
| entity dropdown | 支持单选 | 支持搜索/建议 | 支持多实体和关系过滤 |
| remote search | 暂缓或只读建议 | 通过 extension query 执行 | 支持分页、缓存、错误态 |
| conditional fields | 暂缓 | 小规则 DSL | 复杂场景转 custom command surface |
| arbitrary extension renderer | 不支持 | 不支持 | 只在隔离 extension surface 内支持 |

这里的产品判断是：如果一个操作需要大量自由联动，它很可能不是 HITL approval card 应该承载的东西，而应该是 extension command page 或专门的业务 canvas。HITL 只承载“已经成形的 action proposal”。

### 9.3 为什么不用现成 form 方案直接做 schema form

直接上 schema form 有三个风险：

1. 容易把问题重新定义成 “JSON Schema UI 做得够不够强”，从而忘掉 entity/action/policy。
2. 复杂联动会把业务逻辑塞进 renderer，破坏 extension/runtime/renderer 边界。
3. 用户看到的是字段，不是业务变化，HITL 次数不会真正下降。

因此表单引擎最多是 Action Canvas 的一个 renderer plugin。协议的 source of truth 必须是 Action Proposal。

## 10. V1 落地范围

V1 不应该做通用 workflow engine，也不应该一次性做复杂 merge。V1 只需要把当前 extension tool approval 升级成 action proposal 的最小可用闭环。

### 10.1 协议最小集

V1 字段：

- `entities`: optional entity definitions
- `actions`: optional action definitions
- `action.preview`
- `action.policy`
- `proposal.preview.facts`
- `proposal.effects`
- `proposal.reversible`
- `proposal.evidence`

暂缓：

- 复杂 workflow DSL
- 通用 CRDT
- extension 自定义 React HITL renderer
- 长期授权规则 UI
- 多 action batch planner

### 10.2 与现有 tool contract 的关系

短期不需要删除 `ExtensionToolDefinition`。Action 可以先编译到 tool：

```text
ExtensionActionDefinition
  -> internal tool binding
  -> existing ToolApprovalMiddleware
  -> proposal-aware review payload
  -> existing interrupt/resume
```

迁移映射：

| 当前字段 | V1 action proposal 映射 |
|---|---|
| `tool.title` | `action.title` |
| `tool.description` | `action.description` |
| `inputSchema` | `action.inputSchema` |
| `approval.confirmation.info` | `preview.facts` |
| `approval.riskLabel` | `policy.risk` hint |
| `outputs()` | `evidence` / artifacts after commit |
| `access` | policy input, not final decision |

### 10.3 三个 extension 试点

Notion:

- entity: data source / page
- action: create database page, append to page
- preview: title/content/database/effects
- evidence: created page link

GitHub:

- entity: repository / issue
- action: create issue
- preview: repo/title/body/public visibility
- evidence: issue link

Apple Reminders:

- entity: reminder list / reminder
- action: create reminder, complete reminder, delete reminder
- preview: list/title/due date/status
- inverse: complete -> uncomplete if supported; create -> delete as compensation only if user allows

这三个足够覆盖 create/update/delete/open、private/public/system、reversible/non-reversible 的主要边界。

### 10.4 V0 / V1 / V2 推荐切法

V0：不改大架构，只把现有 `approval.confirmation` 升级成 proposal-shaped payload。

- 新增 shared `ExtensionActionProposal` 类型。
- Notion 的 confirmation info 迁移到 `preview.facts`。
- GitHub create issue 和 Apple Reminders create/complete/delete 补 proposal preview。
- Renderer 增加 generic Action Canvas，不写 Notion/GitHub/Reminders 特判。
- Policy 仍可先接现有 `permissionMode + access`，但 payload 已经携带 risk/reversible/visibility。

V1：让 proposal 真正参与 policy。

- action registry 从 extension package 暴露。
- policy 使用 `risk / reversible / externalVisibility / targetConfidence / conflicts`。
- 低风险可逆动作在 auto mode 下不进 HITL。
- 目标歧义进入 clarification，而不是 approval。
- commit result 产生 evidence，并进入 artifact/output pipeline。

V2：做更强的业务协同。

- entity version / etag / updatedAt conflict check。
- inverse / compensation registry。
- short-lived trust scope。
- batch action proposal。
- 对复杂业务操作开放隔离 extension surface，而不是把所有复杂度塞进审批卡。

## 11. Concrete proposal examples

这一节用当前三个 extension 的真实工具输入写示例，目的是约束协议不要飘。示例字段不要求 V0 全量实现，但每个 example 都应该能变成测试 fixture。

### 11.1 Notion create database page

当前真实 tool input：

```ts
{
  dataSourceId: string
  title: string
  content?: string
  contentBlocks?: Array<{ type: "bookmark"; url: string }>
  properties?: Record<string, NotionPropertyInput>
  addDateDivider?: boolean
  titlePropertyName?: string
}
```

对应 proposal：

```ts
{
  actionId: "notion.createDatabasePage",
  extensionName: "notion",
  input: {
    dataSourceId: "ds_123",
    title: "2026-06 AI 资讯速览",
    content: "# 2026-06 AI 资讯速览\n..."
  },
  preview: {
    summary: "Create a Notion page in Post.",
    facts: [
      { label: "Title", value: "2026-06 AI 资讯速览" },
      { label: "Content", value: "# 2026-06 AI 资讯速览\n..." },
      { label: "In data source", value: "Post" }
    ],
    effects: [
      {
        kind: "create",
        label: "Create a page",
        entity: {
          extensionName: "notion",
          type: "data_source",
          id: "ds_123",
          label: "Post"
        }
      }
    ]
  },
  policy: {
    disposition: "require_approval",
    externalVisibility: "workspace",
    reason: "Ask to Edit mode requires approval for write extension actions.",
    reversible: false,
    risk: "medium",
    targetConfidence: "high",
    conflicts: []
  },
  evidence: []
}
```

V0 可以直接从当前 `approval.confirmation.info` 迁移到 `preview.facts`。V1 再补 `target`、`effects`、`externalVisibility` 和 commit result evidence。

### 11.2 GitHub create issue

当前真实 tool input：

```ts
{
  repositoryFullName: string
  title: string
  body?: string
}
```

对应 proposal：

```ts
{
  actionId: "github.createIssue",
  extensionName: "github",
  input: {
    repositoryFullName: "openwork/openwork",
    title: "Extension action proposal protocol",
    body: "Track the WGS action proposal V0 implementation."
  },
  target: {
    extensionName: "github",
    type: "repository",
    id: "openwork/openwork",
    label: "openwork/openwork"
  },
  preview: {
    summary: "Create a GitHub issue in openwork/openwork.",
    facts: [
      { label: "Repository", value: "openwork/openwork", mono: true },
      { label: "Title", value: "Extension action proposal protocol" },
      { label: "Body", value: "Track the WGS action proposal V0 implementation." }
    ],
    effects: [
      {
        kind: "create",
        label: "Create a public issue",
        entity: {
          extensionName: "github",
          type: "repository",
          id: "openwork/openwork",
          label: "openwork/openwork"
        }
      }
    ]
  },
  policy: {
    disposition: "require_approval",
    externalVisibility: "public",
    reason: "Creating a GitHub issue changes a public or shared collaboration surface.",
    reversible: false,
    risk: "high",
    targetConfidence: "high",
    conflicts: []
  },
  evidence: []
}
```

这个例子故意不加入 labels、assignees、milestone，因为当前 AI tool schema 没有这些字段。后续如果 extension 增加这些 input，再进入 proposal facts 和 editable input。

### 11.3 Apple Reminders create reminder

当前真实 tool input：

```ts
{
  title: string
  notes?: string
  dueDate?: string | null
  listId?: string
  priority?: "high" | "medium" | "low" | null
}
```

对应 proposal：

```ts
{
  actionId: "apple-reminders.createReminder",
  extensionName: "apple-reminders",
  input: {
    title: "Review WGS proposal",
    notes: "Check Notion/GitHub/Reminders fixtures.",
    dueDate: "2026-06-15",
    listId: "work",
    priority: "high"
  },
  target: {
    extensionName: "apple-reminders",
    type: "list",
    id: "work",
    label: "Work"
  },
  preview: {
    summary: "Create a reminder in Work.",
    facts: [
      { label: "Title", value: "Review WGS proposal" },
      { label: "List", value: "Work" },
      { label: "Due", value: "2026-06-15" },
      { label: "Priority", value: "high" },
      { label: "Notes", value: "Check Notion/GitHub/Reminders fixtures." }
    ],
    effects: [
      {
        kind: "create",
        label: "Create a local reminder",
        entity: {
          extensionName: "apple-reminders",
          type: "list",
          id: "work",
          label: "Work"
        }
      }
    ]
  },
  policy: {
    disposition: "allow",
    externalVisibility: "private",
    reason: "Low-risk private reminder in auto mode.",
    reversible: true,
    risk: "low",
    targetConfidence: "high",
    conflicts: []
  },
  evidence: []
}
```

在 ask-to-edit mode 下它仍可要求 approval；在 auto mode 下，它是最应该减少 HITL 的典型动作。这个例子也暴露一个实现要求：`listId` 需要 entity resolver 把 id 转成用户可读 list name，否则 canvas 只能显示 raw id。

### 11.4 Apple Reminders delete reminder

删除 reminder 是同一个 extension 内的反例：它是私有数据，但不可逆或至少需要更谨慎的 compensation 语义。

```ts
{
  actionId: "apple-reminders.deleteReminder",
  extensionName: "apple-reminders",
  input: {
    reminderId: "rem_123"
  },
  target: {
    extensionName: "apple-reminders",
    type: "reminder",
    id: "rem_123",
    label: "Review WGS proposal"
  },
  preview: {
    summary: "Delete reminder: Review WGS proposal.",
    facts: [
      { label: "Reminder", value: "Review WGS proposal" },
      { label: "List", value: "Work" }
    ],
    effects: [
      {
        kind: "delete",
        label: "Delete a local reminder",
        entity: {
          extensionName: "apple-reminders",
          type: "reminder",
          id: "rem_123",
          label: "Review WGS proposal"
        }
      }
    ]
  },
  policy: {
    disposition: "require_approval",
    externalVisibility: "private",
    reason: "Deleting a reminder is destructive even though the data is private.",
    reversible: false,
    risk: "destructive",
    targetConfidence: "high",
    conflicts: []
  },
  evidence: []
}
```

这说明 policy 不能只看 `externalVisibility` 或 `access`。同样是 private/write，create 和 delete 的治理不同。

### 11.5 迁移验收矩阵

| Extension action | V0 proposal facts | V0 target label | V0 policy hints | Commit evidence | 减少 HITL 的判断 |
|---|---|---|---|---|---|
| Notion create database page | title/content/data source | data source name | workspace, medium, not reversible | created page link | ask-to-edit 仍确认；auto 可按 policy 决定 |
| Notion append to page | content/page | page title if resolvable | workspace, medium, not easily reversible | page link or appended block count | 多批 block append 折成一次业务 approval |
| GitHub create issue | repo/title/body | repository full name | public, high, not reversible | issue URL | 一定比 raw JSON 更可信，但通常仍确认 |
| Apple Reminders create | title/list/due/priority/notes | list name | private, low, reversible/compensatable | reminder id/open action | auto mode 可减少 HITL |
| Apple Reminders complete | reminder/list/status | reminder title | private, low, inverse possible | reminder id | auto mode 可减少 HITL |
| Apple Reminders delete | reminder/list | reminder title | private, destructive, not reversible | deleted reminder id | 不减少 HITL，保留人类判断 |
| Apple Reminders open | reminder/list | reminder title | system external, low | opened flag | 可短期 trust，避免重复确认 |

V0 的验收不是“所有 action 都少问一次”。真正验收是：

1. 每个 action 都有业务 proposal，而不是 raw args。
2. policy 能区分 create/complete/delete/open。
3. 低风险动作有减少 HITL 的依据。
4. 高风险动作保留 HITL，但展示变得更可判断。
5. 多个底层 API 调用在用户眼里仍是一个业务动作。

## 12. Agent lifecycle

Action Proposal 不是一条新的并行 runtime 状态机。它应该成为现有 HITL review payload 的业务语义扩展，继续复用当前链路：

```text
tool call
  -> ToolPermissionRuntime.evaluate
  -> extension policy provider builds review payload
  -> ToolApprovalMiddleware interrupt
  -> approval.requested
  -> pendingApproval.review
  -> renderer projection
  -> approval.cleared
  -> handler commit
  -> tool result / evidence
```

### 12.1 生命周期状态

协议层可以命名这些状态，但实现上不要新增平行的 `pendingActionProposal`。

| Proposal stage | Runtime fact | Owner | 语义 |
|---|---|---|---|
| `draft` | assistant 正在选择 tool / streaming args | agent/model | 还不能展示为正式 proposal |
| `proposed` | `ToolPermissionRuntime.evaluate` 已拿到完整 args | main policy/provider | 可以生成 preview、policy hints、target confidence |
| `needs_clarification` | V0 可返回普通 assistant follow-up；V1 可扩展 decision | agent/main | 目标不清、缺必要 entity，不应该伪装成 approval |
| `pending_approval` | `HITLRequest.review` + `approval.requested` | runtime/HITL | 人类需要判断，线程进入 interrupted |
| `approved` | `approval.cleared` with approve | runtime | resume 被接受后才继续执行 |
| `rejected` | `approval.cleared` with reject | runtime | handler 不执行，tool message 返回 rejected |
| `committed` | tool result + `tool.updated` | extension handler/runtime | 业务动作执行完成 |
| `evidenced` | extension outputs / artifacts / links | extension/output pipeline | 用户和 agent 能检查结果 |

关键点：`proposed` 到 `pending_approval` 是 main 侧 policy 决策；`approved` 到 `committed` 是 resume 之后 handler 执行。Renderer 只展示当前 `pendingApproval.review`，不拥有 proposal 状态。

### 12.2 Agent 选择动作的边界

Agent 可以把自然语言 intent 映射到 extension action，但不能自己发明 action。可执行动作必须来自 extension registry。

```text
Good:
  loadExtension("github")
  -> choose listed action/tool createIssue
  -> args match schema
  -> platform builds proposal

Bad:
  model invents "archive stale repositories"
  -> renderer shows a nice card
  -> handler has no registered action
```

V0 仍然可以通过现有 `callExtension` tool 执行，但 prompt 和 tool detail 应该表达新的约束：

- 先用 read/query tools resolve target entity。
- 只有 target 和 required fields 足够明确时才调用 write action。
- 如果目标不明确，先问用户或调用 query tool，不要提交一个需要用户“审批猜测”的 write。
- write action 的 args 应该是业务字段，不是 UI 展示字段。
- 不要为了减少 HITL 而把多个不同业务意图塞进一个 custom tool call。

### 12.3 Clarification 不是 approval

WGS 要减少 HITL，必须把“我不知道你指哪个对象”和“我准备做高风险动作”分开。

| 情况 | 应该发生什么 | 不应该发生什么 |
|---|---|---|
| repository 名称缺失 | assistant 追问或先 search/list repositories | 弹 approval 让用户从 raw args 猜 |
| Notion data source 未解析 | call `getDatabases` / `retrieveDataSource` | 创建页面前让用户审批一个 raw id |
| Reminder listId 不确定 | list reminders/lists 或追问 | 默认写进某个列表 |
| GitHub issue 会公开发布 | 生成清晰 proposal 并 require approval | auto mode 静默创建 |
| 删除 reminder | require approval | 因为 private 就自动执行 |

V0 可以先不新增 `require_clarification` decision type：clarification 由 agent 在调用 write action 前完成。V1 再考虑把 `require_clarification` 作为 policy disposition 显式进入 runtime。

### 12.4 Commit 前后的不变量

Action Proposal 进入 runtime 后，必须保持这些不变量：

1. Approve 的 payload 必须等于 commit 的 payload；用户编辑后要重新 validate 和重新 evaluate policy。
2. `approval.cleared` 只能说明 resume decision 被 runtime 接受，不代表业务动作已经成功。
3. Commit 成功必须产生 tool result；有用户可见对象时应产生 evidence。
4. Commit 失败不能伪装成成功 evidence；可恢复失败应该返回结构化 tool result。
5. Proposal preview 不能只存在 renderer；它必须能从 `review_payload` 恢复。
6. 如果 commit 前发现 target version 冲突，V1 应重新生成 proposal 或进入 approval/clarification，而不是继续执行旧 preview。

### 12.5 Trace 和指标落点

现有 trace 已记录 `approval.requested`、tool started/updated、run interrupted 等事实。Action Proposal 不需要新增另一套日志，但需要在现有 payload 里保留可统计字段：

- `extensionName`
- `actionId`
- `risk`
- `externalVisibility`
- `reversible`
- `targetConfidence`
- `policy.disposition`
- `conflicts.length`
- `evidence.kind`

这样才能计算后文的 HITL 指标，并区分“少审批是因为低风险自动化”还是“少审批是因为错误绕过了安全边界”。

## 13. Hard product tradeoffs

这套方向真正难的地方不是写 schema，而是决定 Openwork 到底要把多少业务 UI 能力放进 HITL。下面这些问题不能用“表单库支持不支持”来回答，必须用产品边界回答。

| 问题 | 激进做法 | 保守做法 | 推荐 |
|---|---|---|---|
| 下拉是否支持 remote search | approval card 内实时查远端 | 只展示已解析 target，缺失就让 agent 先 query | V1 支持受控 entity query，不在 renderer 跑任意远端逻辑 |
| 字段联动做到多强 | 做完整 form engine | 只支持静态 enum 和简单 require/show/hide | V1 小规则 DSL，复杂联动转 extension command surface |
| Extension 能否自定义 HITL React | 允许 extension 提供任意 approval UI | 平台只提供 generic canvas | V1 不允许；V2 只在隔离 extension surface 探索 |
| 长期授权怎么做 | 用户批准一次后永久自动 | 每次都问 | 先做 short-lived trust scope，按 action/risk/entity scope 计时 |
| Batch action 怎么展示 | 把一批动作压成一个 approve | 每个 action 单独 approve | V2 做 batch proposal，但必须能展开每个 action delta |
| Agent 能否改 proposal | 在 UI 里直接编辑后提交 | 拒绝后重新 prompt | V0 不做 edit；V1 edit 后必须 revalidate + re-evaluate policy |
| 失败后是否自动补偿 | handler 自己悄悄补偿 | 全部失败后交给用户 | 只对声明了 inverse/compensation 的 action 自动建议，不静默执行 |

最重要的取舍：HITL 不是承载完整业务操作的地方。它只审阅已经成形的 action proposal。复杂业务构造应该发生在 agent 前置查询、extension command page 或专门 canvas 中，而不是把 approval card 变成一个小型业务应用。

## 14. Extension authoring model

第三方作者不应该从“我有几个 API endpoint”开始设计 WGS extension，而应该从“这个软件里哪些实体会被人和 agent 共同操作”开始。

### 14.1 Authoring layers

| Layer | Author declares | Openwork uses it for | Not for |
|---|---|---|---|
| Entity | stable id、display label、url、query/resolver | target resolution、preview、audit、evidence | 随手拼 UI label |
| Action | finite business operation、input schema、target entity | intent mapping、policy、commit | 任意 API wrapper |
| Preview | facts、effects、before/after summary | Action Canvas | marketing copy |
| Policy hint | risk、visibility、reversible、target confidence | platform policy input | lowering platform risk |
| Evidence | commit result links/artifacts/entity refs | user inspection、agent follow-up | success theater |
| Command page | rich interactive business UI | complex construction before proposal | final approval authority |

This keeps the layers separate:

```text
skill = method / workflow knowledge
extension = integration shell around entities/actions/tools/pages
assistant-core = intent mapping and reasoning
Openwork runtime = governance, HITL, persistence, evidence
```

### 14.2 How to choose entities

Good entities are:

- persistent across runs
- recognizable by users
- addressable by API
- useful as action targets or evidence
- displayable without fetching huge payloads

Examples:

| Extension | Good entities | Weak entities |
|---|---|---|
| Notion | data source, page, block | raw rich text fragment without id |
| GitHub | repository, issue, pull request, label | search result row without stable URL/id |
| Reminders | list, reminder | date bucket like "today" unless resolved to reminders |
| Email | mailbox, thread, message, draft | inbox count |
| CRM | account, contact, opportunity, task | dashboard widget |

If the object cannot be re-resolved later, it should probably be a preview fact, not an entity.

### 14.3 How to choose actions

Good actions are finite business operations:

- create issue
- add label to issue
- create reminder
- complete reminder
- append content to page
- create database page
- publish draft
- send message

Weak actions are either too low-level or too broad:

| Too low-level | Why weak |
|---|---|
| `postJson` | API wrapper, no business semantics |
| `updateField` | hides which entity and what effect matters |
| `runQuery` | read/query tool, not a business action |

| Too broad | Why weak |
|---|---|
| `fixProject` | unbounded workflow, not one operation |
| `organizeWorkspace` | cannot preview delta safely |
| `handleCustomer` | mixes research, writing, notification, and commit |

Recommended action grain:

```text
one action = one user-comprehensible business delta
```

It may perform multiple API calls internally, but the user should be able to approve or reject it as one coherent change.

### 14.4 Action authoring checklist

Before adding a write/external action, the extension author should answer:

1. What entity does this action target or create?
2. Can the target be resolved before commit?
3. What is the smallest useful preview?
4. What visible delta will happen?
5. Is the action private, workspace-visible, public, or system-external?
6. Is it reversible, compensatable, or irreversible?
7. What evidence will prove success?
8. What conflicts can happen between preview and commit?
9. Which fields are required for safe execution?
10. Which part belongs in a command page instead of approval?

If the author cannot answer these, the action is probably not ready for Action Proposal. It may remain a plain tool or a command page.

### 14.5 Anti-patterns

| Anti-pattern | Why it hurts WGS | Better shape |
|---|---|---|
| One generic `execute` action | Infinite intent leaks back into one tool | declare finite actions |
| Huge schema form in approval | HITL becomes app UI | construct in command page, approve final proposal |
| Natural-language risk reason only | policy cannot verify it | structured risk/visibility/reversible fields |
| Preview duplicates raw args | user still reviews parameters | preview business delta |
| Action hides multiple unrelated commits | approval loses meaning | batch proposal with expandable actions |
| Custom renderer required for basic action | third-party UI becomes governance surface | generic proposal first |
| Entity id is user-facing label only | audit/replay breaks after rename | stable id plus display label |

### 14.6 Authoring docs implication

Future extension docs should teach authors this order:

1. Define entities.
2. Define read/query tools to resolve entities.
3. Define finite write/external actions.
4. Define preview/effects/policy hints.
5. Define evidence.
6. Only then add optional command UI for complex construction.

This is the opposite of a classic API wrapper tutorial. The author is not just exposing endpoints; they are declaring a small business operation language.

## 15. Third-party trust model

允许第三方 extension 声明 entity/action 是 WGS 的关键，但这不等于把治理权交给 extension。声明是 evidence，不是 authority。

### 15.1 Trust boundary

Extension may declare:

- entity type, id, display label, url
- action id, title, description
- input schema and choice sources
- preview facts and effects
- policy hints such as risk, visibility, reversibility
- inverse/compensation hints
- evidence mapping after commit

Extension must not decide:

- final allow / deny / require approval
- whether an action can bypass user approval
- whether a public/destructive action is low risk
- whether auth scope is sufficient
- whether another extension's entity/action namespace can be used
- whether renderer should trust custom code inside approval UI

Platform owns final policy. Extension hints can increase clarity, but they cannot lower platform-derived risk.

### 15.2 Policy override rules

Platform should derive a risk floor before considering extension hints.

| Signal | Platform minimum |
|---|---|
| `access === "read"` | may allow if auth scope is valid |
| `access === "write"` | at least medium unless action is known low-risk/private/reversible |
| `access === "external"` | at least medium; public/system boundary may require approval |
| `effect.kind === "delete"` | destructive unless inverse is proven |
| `externalVisibility === "public"` | high by default |
| missing target / low target confidence | clarification, not approval |
| missing auth / missing declared permission | deny |
| invalid proposal shape for proposal-enabled action | deny or fail visibly in main, not renderer fallback |

Risk calculation should be monotonic:

```text
finalRisk = max(platformRiskFloor, extensionRiskHint)
```

An extension may say “this is high risk” and make the platform stricter. It may not say “this public publish action is low risk” and make the platform looser.

### 15.3 Package trust tiers

V1 policy should distinguish package trust from action risk.

| Package tier | Meaning | Default policy stance |
|---|---|---|
| built-in | maintained with Openwork, covered by repo tests | may use full proposal protocol |
| trusted installed | user explicitly trusted package source | may use proposal protocol, but policy still applies |
| dev/local | developer mode package | require explicit trust before write/external auto behavior |
| untrusted installed | installed but not trusted | read/query only by default; write/external requires approval or deny |

This mirrors the lesson from extension permission systems: declaring intent is useful, but the host must still gate capabilities, show permission meaning to the user, and support revocation.

### 15.4 Manifest and permission model

Action declarations should be tied to install-time and runtime permission surfaces:

```text
manifest capabilities
  -> connection/auth scopes
  -> declared entities/actions
  -> runtime policy
  -> action proposal
```

Required checks:

1. `actionId` is namespaced by extension package.
2. `extensionName` in proposal matches the executing package.
3. action access/effects are covered by manifest capability.
4. connection scope supports the target operation.
5. package version is recorded with proposal/evidence.
6. permission changes require re-consent or trust refresh.

This prevents a confused-deputy path where one extension proposes an action under another extension's identity, or where a package update silently broadens its action surface.

### 15.5 Prompt injection and description injection

Third-party descriptions, action titles, preview text, and remote entity labels are untrusted text. They help the model and user understand the operation, but they must not become platform instructions.

Rules:

- Extension tool docs are context, not system policy.
- Extension text cannot override permission mode.
- Remote entity labels should be displayed as data, not interpreted as instructions.
- Detailed tool docs should stay on-demand to avoid loading untrusted long descriptions into every run.
- The policy evaluator should use structured fields, not natural-language descriptions, for risk decisions.

This aligns with the existing direction that active runtime tool calls stay control-only and display metadata belongs in message/projection layers.

### 15.6 Audit and revocation

For third-party action proposals, audit should include:

- package id/version
- capability id/version
- action id
- input hash or compact input summary
- target entity ref
- final policy decision
- platform risk floor
- extension risk hint
- user decision if any
- commit result/evidence

Revocation semantics:

- disconnecting a connection disables future commits for that provider.
- untrusting a package disables write/external actions.
- package update that changes declared actions should invalidate prior short-lived trust.
- stored evidence remains as historical fact even if package trust is revoked.

The point is not to distrust every extension forever. The point is to make trust explicit, scoped, inspectable, and reversible.

## 16. 当前代码落点

这套方案不应该从 renderer 特判开始实现。当前代码里已经有合适的 owner，只需要把 action proposal 作为新的 shared contract 插进去。

| 责任 | 当前 owner | 变化方向 |
|---|---|---|
| extension 作者 API | `packages/extension-api/src/shared/extension-sources.ts` | 新增 `ExtensionActionDefinition`、`ExtensionEntityDefinition`、`ActionProposal` 类型 |
| extension runtime tool binding | `src/main/extension-tools/registry.ts` 和 `permission.ts` | action 可以先编译成现有 tool binding；`permission.ts` 负责生成 proposal-aware review |
| approval interrupt gate | `src/main/agent/tool-approval-middleware.ts` | 保持只做 allow/deny/interrupt/resume，不承载业务语义 |
| HITL durable request | `src/shared/hitl.ts` | `review` 里携带 action proposal；allowed decisions V0 仍可保持 approve/reject |
| approval view model | `src/shared/tool-approval.ts` 和 renderer projection | extension approval item 增加 proposal 字段；renderer 不从 tool name 猜字段 |
| approval UI | `src/renderer/src/components/chat/*` | 新增 generic Action Canvas component，消费 proposal view model |
| output/evidence | `outputs()` / artifact pipeline | commit result 进入 evidence/artifacts，不重复造展示协议 |

关键边界：

- `ToolApprovalMiddleware` 不应该知道 Notion/GitHub/Reminders 的业务字段。
- `permission.ts` 可以调用 extension 的 preview/policy hint，但最终 allow/deny/approval 仍由平台 policy 决定。
- `ToolApprovalItem` 可以携带 proposal，但不应该把 proposal 拆成多个 UI-only 状态源。
- Renderer 缺 proposal renderer 时应该暴露清晰不可渲染状态；不要猜字段、不要退回一堆 raw JSON 伪装成产品体验。

## 17. V0 implementation package

V0 的目标不是一次性完成 WGS，而是把现有 extension approval 从 `confirmation facts` 升级为 `proposal-shaped review payload`。这一包应该小到可以 review，但必须让后续 V1 policy 有真实数据可以接。

### 17.1 Shared contract 草案

V0 可以先不暴露完整 `ExtensionActionDefinition` registry，只在 shared contract 里增加 action proposal payload。

建议落点：

- `packages/extension-api/src/shared/extension-sources.ts`
- `src/shared/extension-sources.ts`
- `src/shared/tool-approval.ts`

最小类型：

```ts
export type ExtensionActionRisk = "low" | "medium" | "high" | "destructive"
export type ExtensionActionVisibility = "private" | "workspace" | "public" | "system" | "unknown"

export interface ExtensionEntityRef {
  extensionName: string
  id: string
  label?: string
  type: string
  url?: string
}

export interface ExtensionActionPreviewFact {
  label: string
  mono?: boolean
  value: string
}

export interface ExtensionActionEffect {
  detail?: string
  entity?: ExtensionEntityRef
  kind: "create" | "update" | "delete" | "external" | "notify" | "publish" | "custom"
  label: string
}

export interface ExtensionActionPolicyHint {
  externalVisibility: ExtensionActionVisibility
  reason?: string
  reversible: boolean
  risk: ExtensionActionRisk
  targetConfidence: "high" | "medium" | "low"
}

export interface ExtensionActionProposal {
  actionId: string
  evidence?: ExtensionToolOutput[]
  extensionName: string
  input: Record<string, unknown>
  policy: ExtensionActionPolicyHint
  preview: {
    effects: ExtensionActionEffect[]
    facts: ExtensionActionPreviewFact[]
    summary: string
  }
  target?: ExtensionEntityRef
  title: string
  version: 1
}
```

Then extend:

```ts
export interface ExtensionToolApprovalDefinition {
  confirmation?: ExtensionToolConfirmationBuilder
  proposal?: ExtensionActionProposalBuilder
  riskLabel?: "write" | "external" | "destructive"
}

export interface ExtensionToolApprovalItem {
  // existing fields
  proposal?: ExtensionActionProposal
}
```

V0 可以保留 `confirmation`，但新的 extension 应优先写 `proposal`。Notion 现有 confirmation 可以先通过 adapter 生成 proposal，避免一次改动要求所有 extension 同步迁移。

### 17.2 Main/runtime 改动顺序

建议按这个顺序做，避免 renderer 先行：

1. 在 shared/extension-api 增加 proposal 类型和 parser。
2. 在 `parseToolApprovalItem` / `buildExtensionToolApprovalItem` 保留并恢复 `proposal`。
3. 在 `src/main/extension-tools/permission.ts` 中优先调用 `approval.proposal`，没有时再映射 `confirmation`。
4. 在 Notion/GitHub/Apple Reminders 各补一个 proposal builder。
5. 在 renderer large approval view model 增加 proposal 分支。
6. 再考虑 Action Canvas component 的视觉升级。

这里的兼容是有边界的：`confirmation -> proposal` adapter 只是迁移桥，不是长期双协议。V1 应删除旧 confirmation 主路径，或把它降级为 proposal.preview.facts 的简写。

### 17.3 Renderer V0 行为

V0 不需要做完整 schema form。Action Canvas 的最小展示：

- title: `proposal.title`
- summary: `proposal.preview.summary`
- target: `proposal.target`
- facts: `proposal.preview.facts`
- effects: `proposal.preview.effects`
- policy chips: risk / visibility / reversible / target confidence
- fallback details: raw args 只在 dev/debug 折叠区出现

V0 禁止：

- 根据 `extensionName === "notion"` 写分支。
- 从 `toolName` 字符串推断业务字段。
- 在 renderer 内调用 extension query。
- 在 React local state 保存 proposal lifecycle。

### 17.4 测试计划

Node tests:

| 文件 | 应补断言 |
|---|---|
| `tests/node/tool-approval.test.ts` | `buildExtensionToolApprovalItem` 能携带 proposal |
| `tests/node/hitl-review.test.ts` | `extractHitlRequestFromValuesState` 和 `mapHitlRowToRequest` 能恢复 proposal |
| `tests/node/approval-large-presentation.test.tsx` | proposal facts/effects/policy 是主要展示，raw args 不抢主视觉 |
| `tests/node/hitl-display-size.test.ts` | extension proposal approval 使用 large display |
| `tests/node/notion-ai-migration-tools.test.ts` | Notion create page proposal 包含 title/content/data source |
| `tests/node/github-notion-ai-tools.test.ts` 或 GitHub source test | GitHub create issue proposal 不包含 schema 没有的 labels/assignees |
| `tests/node/apple-reminders-source-tools.test.ts` | create/complete/delete 的 risk/reversible 不同 |
| `tests/node/message-projection.test.ts` | pending approval 仍只投到 owning turn，不因 proposal 新增状态 |

BDD tests:

| 文件 | 场景 |
|---|---|
| `tests/bdd/features/tool-approval.feature` | 待审批请求恢复时保留 action proposal review payload |
| `tests/bdd/features/agent.feature` | HITL resume 后 proposal 清理仍由 `approval.cleared` 驱动 |

不需要为纯文档或类型草案强行跑 BDD。但实现 V0 时，因为改到 main/preload/renderer 协作边界，应该至少跑相关 node tests；如果 runtime 恢复或持久化路径变动，再跑 BDD tool approval/agent 场景。

### 17.5 Rollout 风险

| 风险 | 触发方式 | 防线 |
|---|---|---|
| review payload 变大 | content/body 很长 | facts 做摘要，完整 input 留在 `tool_call.args` 或折叠 raw args |
| 旧 confirmation 和新 proposal 双源冲突 | extension 同时返回两者 | V0 明确 proposal 优先，并在 tests 覆盖 |
| renderer 偷偷猜字段 | proposal 缺字段时想美化 | 缺 proposal 就展示不可渲染/原始调试区，不做业务猜测 |
| policy 被 extension 绕过 | extension 把 high risk 标成 low | extension 只给 hint；平台 policy 可上调风险，不能被 extension 降级 |
| auto mode 误少问 | low/reversible 判断过宽 | V1 前只记录 policy hints，不急着改变 allow/approval |
| evidence 和 outputs 重复 | proposal 自带 evidence，handler 又 outputs | V0 evidence 先作为 planned/expected；commit result 仍走 outputs/artifact |

### 17.6 Patch slices

实现时建议拆成这些可独立 review 的 patch：

1. **Contract patch**：只加 shared types、zod parser、`ToolApprovalItem.proposal`，补 `tool-approval.test.ts` 和 `hitl-review.test.ts`。
2. **Provider patch**：`permission.ts` 支持 `approval.proposal`，并把旧 confirmation 映射为 proposal facts；补 provider 单测。
3. **Extension fixture patch**：Notion/GitHub/Apple Reminders 各补 proposal builder，只测试 payload，不改 renderer。
4. **Renderer patch**：large approval view model 支持 proposal，Action Canvas V0 使用现有组件；补 `approval-large-presentation.test.tsx`。
5. **Projection/runtime patch**：确认 pending approval owning turn、resume clear、review restore 不变；只在需要时补 `message-projection` / runner tests。
6. **Policy patch**：在 V1 前不要改变 auto/ask-to-edit 行为；先把 policy hints 记录进 trace/metrics。

每个 patch 的判断标准：

- 是否让 WGS 更真实，而不是只让 card 更漂亮？
- 是否保持 owner 边界？
- 是否有对应测试证明 review payload 能持久化、恢复、展示？
- 是否避免把旧 confirmation 路线长期保留成第二 source of truth？

## 18. 与旧 HITL form 文档的关系

`extension-hitl-experience-architecture.md` 和 `extension-hitl-experience-detailed-design-cn.md` 仍有价值，但它们应该被理解为较低层的交互设计：

```text
old docs:
  how to render and edit tool input safely

this doc:
  what business operation is being proposed and governed
```

如果后续继续实现 schema form，应把它接到 Action Canvas 的 editable input 区，而不是把 “form submit” 当作 extension HITL 标准。

## 19. 实施检查点

实现前先回答这些问题：

1. 这个 extension 暴露了哪些 entity？
2. 每个 action 的 target entity 是什么？
3. preview 是否表达业务 delta，而不是 JSON args？
4. policy 是否能只从 proposal facts 判断风险？
5. commit 前是否需要检查 entity version / updatedAt / etag？
6. 成功后有哪些 evidence？
7. 失败后用户和 agent 如何恢复？
8. 这个 action 是 inverse、compensation，还是 none？

验收标准：

- Notion/GitHub/Reminders 不需要写 UI 特判，也能展示稳定业务 proposal。
- Renderer 不从 tool name 猜测业务字段。
- Missing action renderer/protocol 是清晰错误或不可渲染状态，不吞成 raw JSON。
- 低风险可逆动作能按 policy 减少 HITL。
- 高风险动作即使在 auto mode 也能被 policy 拦住。
- Commit result 能形成可点击或可检查 evidence。

### 19.1 观测指标

这个方向是否真的减少 HITL，不能只靠体感。需要记录这些指标：

| 指标 | 说明 |
|---|---|
| approvals per user request | 一个用户意图触发几次人工审批 |
| approvals per committed action | 一个成功业务动作需要几次审批 |
| clarification rate | 因目标不明确而追问，而不是审批的比例 |
| rejection / re-prompt rate | 用户拒绝后重新 prompt 的比例 |
| edit-before-approve rate | 用户只小修字段就继续的比例 |
| post-commit correction rate | 执行后用户手动纠错或要求撤回的比例 |
| auto-commit recovery rate | 自动执行后通过 inverse/compensation 恢复的比例 |
| time waiting approval | agent 因 HITL 阻塞的时间 |

目标不是简单降低 approval 数量，而是在不降低信任的前提下，把 approval 留给真正需要人类判断的地方。

## 20. Source map

### 20.1 External references

| Source | Used for | Boundary |
|---|---|---|
| [Structured-Prompt-Driven Development](https://martinfowler.com/articles/structured-prompt-driven/) | Prompt / intent as a structured, reviewable artifact | Inspires proposal artifact discipline; does not define business action runtime |
| [Amazon Canvas](https://www.aboutamazon.com/news/innovation-at-amazon/amazon-sellers-canvas-artificial-intelligence) | Business-context canvas with data, visuals, recommendations, and actions | Product reference for Action Canvas; not a reusable protocol |
| [Apple App Intents](https://developer.apple.com/documentation/appintents) | App-declared actions/entities/queries exposed to system surfaces | Strongest entity/action precedent; lacks Openwork-specific policy/evidence/checkpoint semantics |
| [MCP tools](https://modelcontextprotocol.io/specification/2025-06-18/server/tools) | Tool input/output schema, security considerations, confirmation guidance | Tool interoperability layer; not a business proposal governance layer |
| [Amazon Bedrock Agents action groups](https://docs.aws.amazon.com/bedrock/latest/userguide/agents-action-create.html) | Action groups, parameter elicitation, fulfillment | Useful action grouping precedent; too host-specific for Openwork desktop runtime |
| [JSON Forms rules](https://jsonforms.io/docs/uischema/rules/) | Conditional form UI rules | Candidate for future editable input renderer only |
| [react-jsonschema-form dependencies](https://rjsf-team.github.io/react-jsonschema-form/docs/json-schema/dependencies/) | Dynamic schemas / dependent fields | Candidate for future editable input renderer only |
| [ProseMirror transform guide](https://prosemirror.net/docs/guide/) | Finite steps, transaction, replay, invert, collaboration | Conceptual model for finite operations; not directly reusable for business software |
| [Chrome extension permissions](https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions) | Manifest-declared permissions, warnings, optional permissions, user consent | Trust-model analogy only: declaration helps explain capabilities, but host still gates and revokes |

### 20.2 Repo evidence

| Evidence | What it proves |
|---|---|
| `packages/extension-api/src/shared/extension-sources.ts` | Current extension contract is tool-centric: `access/inputSchema/approval/handler/outputs` |
| `src/shared/hitl.ts` | Current HITL decisions are approve/reject; display size is still approval-card oriented |
| `src/shared/tool-approval.ts` | Extension approval currently carries args, confirmation, source/title metadata, but no action proposal |
| `src/main/extension-tools/permission.ts` | Current extension approval provider is the correct owner to build proposal-aware review payload |
| `src/main/agent/tool-approval-middleware.ts` | Runtime already has a clean interrupt gate; it should not learn business semantics |
| `src/shared/agent-thread-runtime.ts` | `approval.requested` / `approval.cleared` already own pending approval lifecycle |
| `src/main/agent/runtime-state.ts` | `review_payload` is persisted and restored separately from tool args |
| `installable-extensions/notion/main/tools.ts` | Notion's nice display comes from handwritten confirmation facts, not a schema/action standard |
| `installable-extensions/github/main/tools.ts` | GitHub create issue is write-capable but lacks confirmation/proposal; current schema has repo/title/body only |
| `installable-extensions/apple-reminders/main/tools.ts` | Reminders has private low-risk and destructive actions in the same extension, proving access alone is insufficient |
| `tests/node/hitl-review.test.ts` | Existing tests already protect review payload persistence/restoration |
| `tests/node/approval-large-presentation.test.tsx` | Existing renderer tests can be extended to prove proposal-first presentation |
| `tests/bdd/features/tool-approval.feature` and `tests/bdd/features/agent.feature` | Existing BDD paths cover HITL extraction/resume and should remain the runtime acceptance layer |

### 20.3 Skill and extension boundary evidence

This proposal follows two local boundary rules:

- `launcher-extension-guardrails`: extension SDK is the author API; extension code should only use public/shared host contracts; AI remains platform-native.
- `skill-ecosystem-thinking`: Openwork is assistant-first; extensions are integration shells around skills/tools/pages, not peers of assistant-core.
- `desktop-microinteraction-design`: desktop feedback should be local, immediate, reversible where possible, quiet, and attached to the smallest object that owns the result.

Therefore Action Proposal belongs between assistant-core and extension integration. It should not become a launcher plugin abstraction, and it should not collapse skills, extension UI, and runtime approval into one layer.

## 21. 最重要的产品判断

Openwork 真正的机会不是做一个更漂亮的审批卡，而是让外部软件把自己的业务世界声明给 agent。

传统 extension 是：

```text
软件暴露 API
agent 调 API
用户审批 API 调用
```

WGS extension 应该是：

```text
软件声明实体和有限操作
agent 把无限意图压成操作提案
Openwork 治理提案
用户只在需要判断时介入
```

这才是从 coding IDE 走向业务软件的关键一步。
