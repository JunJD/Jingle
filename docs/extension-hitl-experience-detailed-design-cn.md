# Extension HITL 体验优化详设

## 1. 背景

Openwork 现在已经有 HITL，但它更像一个平台级安全闸门：模型准备执行工具，main process 判断这个工具调用是允许、拒绝还是需要人工审批；如果需要审批，就通过 LangGraph interrupt 暂停运行，renderer 展示一个 approve/reject 卡片。

这个架构安全性不错，但体验不够。用户看到的是“即将运行某个工具 + 参数/原因”，只能批准或拒绝。如果模型选对了工具但参数有小错，比如 GitHub issue 标题需要改一句、Notion page 内容需要补一段、Reminder due date 不对，用户只能拒绝后重新 prompt。这个交互成本高，也不符合 extension command 页已经形成的“表单字段可编辑”的产品心智。

目标不是推翻现有 HITL，而是在现有安全闸门里补上 extension tool 专属的交互协议：

```text
tool call args
  -> policy approval gate
  -> confirmation + schema form
  -> user edits / approves / rejects
  -> main re-validates and re-checks policy
  -> execute handler
```

这份文档定义目标体验、数据协议、运行时状态机、renderer 行为、实现分期、验收标准和风险边界。

## 2. 现状

### 2.1 现有能力

Openwork 当前已经有这些基础：

| 能力 | 当前实现 |
|---|---|
| Extension tool contract | `ExtensionToolDefinition` 声明 `access / inputSchema / title / description / handler` |
| Tool approval middleware | `ToolApprovalMiddleware.wrapToolCall` 在 handler 前拦截 |
| 权限判定 | `ToolPermissionRuntime` 判断 `allow / deny / require_approval` |
| Extension approval policy | `ExtensionToolApprovalPolicyProvider` 把 `callExtensionTool` 映射到真实 extension tool binding |
| HITL request | `HITLRequest` 保存 `tool_call / allowed_decisions / review` |
| 审批展示 payload | `ToolApprovalItem` 支持 `execute_command / file_mutation / extension_tool` |
| Renderer approval | `DefaultHumanInTheLoop`、`FileMutationHumanInTheLoop`、`ExecuteHumanInTheLoop` 展示审批卡 |
| 持久化 | `hitlRequest.review_payload` 和 `decision` 都是 JSON 序列化，适合向后兼容扩展 |

### 2.2 关键代码事实

`HITLDecision` 当前只有二元决策和 feedback：

```ts
export interface HITLDecision {
  type: HITLDecisionType
  request_id?: string
  tool_call_id?: string
  feedback?: string
}
```

`ExtensionToolApprovalItem` 当前只携带 args 和展示元信息：

```ts
export interface ExtensionToolApprovalItem {
  access: ExtensionToolAccess
  args: Record<string, unknown>
  capabilityDisplayName: string
  capabilityId: string
  extensionName: string
  kind: "extension_tool"
  permissionMode: PermissionModeName
  reason: string
  toolName: string
  toolTitle: string
}
```

`ToolApprovalMiddleware` 的核心行为是：

```text
evaluate permission
  -> allow: handler(request)
  -> deny: return error ToolMessage
  -> require_approval:
       interrupt({ actionRequests, reviewConfigs })
       resume decision
       reject: return rejected ToolMessage
       approve: handler(request)
```

也就是说，现在 approve 后执行的仍是原始 `request.toolCall.args`。用户不能提交修改后的参数。

### 2.3 体验缺口

| 缺口 | 用户影响 | 工程影响 |
|---|---|---|
| 没有 schema form | 参数只能看不能改 | 不能复用 extension `inputSchema` 的 UI 价值 |
| 没有 edited args | approve 无法携带修改后的结构化参数 | middleware resume 流程无法替换 payload |
| 没有 tool-specific confirmation | 不同业务动作看起来都像通用审批 | 扩展作者无法解释“这次会做什么” |
| 没有 revalidation 状态机 | 如果直接加编辑会有安全洞 | 需要 main 侧重校验、重跑 policy |
| 没有 extension-specific HITL renderer | UI 只能显示 generic approval card | 难覆盖 GitHub/Notion/Reminders 的字段体验 |

## 3. 参考架构

### 3.1 Raycast 的启发

Raycast 的 command 页和表单体验给用户形成了一个明确心智：工具输入不是 raw JSON，而是一组字段。字段类型包括 text、textarea、password、checkbox、dropdown 等。即使我们拿不到 Raycast runtime 源码，也可以确定这种 schema/form primitive 对 extension 体验非常关键。

Raycast AI tool 的 `confirmation` 更像执行前确认 contract：工具真正执行前，runtime 展示“将要执行什么”，用户确认后才继续。它解决的是执行前拍板，但不等价于完整的 editable form。

对 Openwork 的结论：

- `confirmation` 负责解释动作。
- `schema form` 负责展示和编辑参数。
- `approval gate` 负责安全边界。

三者应该组合，而不是互相替代。

### 3.2 CopilotKit 的启发

CopilotKit 的 README 把它定位成面向 agent 的前端栈，强调 generative UI、shared state 和 HITL workflows。真正值得学的是架构分层：

| CopilotKit 模式 | 含义 | Openwork 借鉴 |
|---|---|---|
| Tool rendering | tool call 可以在前端渲染成 React UI | extension approval 应该是可渲染的 tool interaction |
| `useHumanInTheLoop` | 前端 tool 接收参数，渲染 UI，然后通过 respond 返回结构化结果 | approval form 应该返回结构化 approved args |
| `useInterrupt` | runtime/graph 主动暂停，等待前端 resolve | 保留 Openwork 现有 LangGraph interrupt 安全闸门 |

Openwork 不应该照搬 CopilotKit API。我们要借鉴的是组合方式：

```text
CopilotKit-style tool rendering and structured response
+ Openwork platform-owned interrupt approval gate
+ Raycast-like form primitives
= usable and safe extension HITL
```

参考：

- [CopilotKit README](https://github.com/CopilotKit/CopilotKit/blob/main/README.md)
- [CopilotKit tool-based HITL with useHumanInTheLoop](https://docs.showcase.copilotkit.ai/llamaindex/human-in-the-loop)
- [CopilotKit interrupt-based HITL with useInterrupt](https://docs.showcase.copilotkit.ai/crewai-crews/human-in-the-loop/useInterrupt)

## 4. 设计目标

### 4.1 产品目标

P0 目标体验：

1. 当 agent 调用 write/external extension tool 且需要 approval 时，用户看到的不只是 raw args，而是一张字段化审批表单。
2. 用户可以直接修改字段。
3. 用户点击 approve 后，main process 使用修改后的参数重新校验并执行。
4. 参数无效时不执行工具，并把错误反馈给 UI。
5. 安全策略不因为可编辑 UI 被绕过。

### 4.2 工程目标

1. 复用现有 `ToolApprovalMiddleware` 和 `ToolPermissionRuntime`。
2. 不破坏现有 file mutation、execute command HITL。
3. P0 不引入数据库迁移，新增字段先放进 `review_payload` 和 `decision` JSON。
4. P0 不做复杂自定义 renderer，先做 generic schema form。
5. P1 再增加 tool-specific confirmation。
6. P2 再增加 custom approval renderer registry。

### 4.3 非目标

P0 不做：

- 远程 preview，比如调用 GitHub API 解析 repo title。
- 完整 JSON Schema/Zod introspection 支持所有复杂类型。
- extension 作者自定义 React HITL UI。
- 多个 approval-required tool call 同时审批。
- 绕过当前 permission mode 的 force-run。

## 5. 总体架构

目标架构：

```text
LLM tool call
  name: callExtensionTool
  args: { extensionName, toolName, args }
        |
        v
ToolApprovalMiddleware.wrapToolCall
        |
        v
ToolPermissionRuntime.evaluate
        |
        v
ExtensionToolApprovalPolicyProvider
  - resolve extension binding
  - resolve access policy
  - build review:
      confirmation
      schema form
      normalized display args
        |
        v
LangGraph interrupt
        |
        v
Renderer ExtensionHumanInTheLoop
  - render confirmation
  - render editable fields
  - submit edited_args
        |
        v
agent:resume
        |
        v
Main resume validation
  - parse edited args by inputSchema
  - re-run permission
  - regenerate review when needed
  - execute handler or re-interrupt
```

核心分层：

| 层 | 所属进程 | 职责 |
|---|---|---|
| Extension contract | shared/main | 声明 tool schema、access、可选 approval metadata |
| Approval planner | main | 从 schema 和 args 生成 confirmation/form/review |
| Approval gate | main | allow/deny/require_approval，触发 interrupt |
| HITL persistence | main/db | 保存 pending request、review payload、decision |
| HITL renderer | renderer | 展示表单，收集 edited args |
| Resume validator | main | 校验 edited args，重跑 policy，执行或重新中断 |

## 6. 协议设计

### 6.1 Extension tool approval metadata

给 `ExtensionToolDefinition` 增加可选 `approval` 字段：

```ts
export interface ExtensionToolDefinition<TInput = unknown, TOutput = unknown> {
  access: ExtensionToolAccess
  description: string
  inputSchema: ZodType<TInput>
  name: string
  outputSchema?: ZodType<TOutput>
  title: string
  approval?: ExtensionToolApprovalDefinition<TInput>
  handler(ctx: ExtensionToolContext, input: TInput): Promise<TOutput> | TOutput
}
```

`approval` 的 P0/P1 形态：

```ts
export interface ExtensionToolApprovalDefinition<TInput = unknown> {
  form?: "auto" | false | ExtensionToolApprovalFormDefinition
  confirmation?: ExtensionToolConfirmationBuilder<TInput>
  riskLabel?: "write" | "external" | "destructive"
}

export interface ExtensionToolApprovalFormDefinition {
  fields?: Record<string, ExtensionToolApprovalFieldHint>
  order?: string[]
}

export interface ExtensionToolApprovalFieldHint {
  label?: string
  description?: string
  placeholder?: string
  component?: "text" | "textarea" | "number" | "checkbox" | "dropdown" | "json"
  rows?: number
  hidden?: boolean
}
```

默认规则：

- `approval` 未声明时，write/external tool 使用 `form: "auto"`。
- read tool 默认不需要 approval form，因为通常不会进入 HITL。
- `form: false` 表示不生成 editable form，只展示 confirmation/raw args。这个选项不允许绕过 approval，只影响 UI。

### 6.2 Confirmation contract

P1 增加 confirmation builder：

```ts
export type ExtensionToolConfirmationBuilder<TInput> = (
  input: TInput,
  context: ExtensionToolConfirmationContext
) => ExtensionToolConfirmation | Promise<ExtensionToolConfirmation>

export interface ExtensionToolConfirmationContext {
  access: ExtensionToolAccess
  capabilityDisplayName: string
  extensionName: string
  permissionMode: PermissionModeName
  toolName: string
  toolTitle: string
}

export interface ExtensionToolConfirmation {
  title?: string
  message?: string
  tone?: "default" | "warning" | "danger"
  facts?: Array<{
    label: string
    value: string
    mono?: boolean
  }>
}
```

约束：

- builder 必须 side-effect free。
- builder 可以 async，但必须 timebox，例如 100ms 或 250ms。
- builder 抛错时 fallback 到 generic confirmation。
- builder 不允许决定是否需要 approval。

### 6.3 Review payload

扩展 `ExtensionToolApprovalItem`：

```ts
export interface ExtensionToolApprovalItem {
  access: ExtensionToolAccess
  args: Record<string, unknown>
  capabilityDisplayName: string
  capabilityId: string
  confirmation?: ToolApprovalConfirmation
  extensionName: string
  form?: ToolApprovalForm
  kind: "extension_tool"
  permissionMode: PermissionModeName
  reason: string
  toolName: string
  toolTitle: string
}

export interface ToolApprovalConfirmation {
  title: string
  message?: string
  tone: "default" | "warning" | "danger"
  facts: ToolApprovalFact[]
}

export interface ToolApprovalFact {
  label: string
  value: string
  mono?: boolean
}
```

### 6.4 Form payload

P0 form 协议：

```ts
export interface ToolApprovalForm {
  schemaVersion: 1
  fields: ToolApprovalField[]
  values: Record<string, unknown>
  unsupportedFields?: string[]
}

export type ToolApprovalField =
  | ToolApprovalTextField
  | ToolApprovalTextareaField
  | ToolApprovalNumberField
  | ToolApprovalCheckboxField
  | ToolApprovalDropdownField
  | ToolApprovalJsonField

export interface ToolApprovalBaseField {
  description?: string
  label: string
  name: string
  required?: boolean
}

export interface ToolApprovalTextField extends ToolApprovalBaseField {
  type: "text"
  placeholder?: string
}

export interface ToolApprovalTextareaField extends ToolApprovalBaseField {
  type: "textarea"
  placeholder?: string
  rows?: number
}

export interface ToolApprovalNumberField extends ToolApprovalBaseField {
  type: "number"
  max?: number
  min?: number
  step?: number
}

export interface ToolApprovalCheckboxField extends ToolApprovalBaseField {
  type: "checkbox"
}

export interface ToolApprovalDropdownField extends ToolApprovalBaseField {
  type: "dropdown"
  options: Array<{ label: string; value: string }>
}

export interface ToolApprovalJsonField extends ToolApprovalBaseField {
  type: "json"
}
```

字段值规范：

| Field type | Value type |
|---|---|
| text | string |
| textarea | string |
| number | number or string draft in renderer, number after main validation |
| checkbox | boolean |
| dropdown | string |
| json | unknown, submitted as parsed JSON |

Renderer 可以维护 draft string，但提交给 main 的 `edited_args` 必须是 object。

### 6.5 HITL decision

扩展 `HITLDecision`：

```ts
export interface HITLDecision {
  type: HITLDecisionType
  request_id?: string
  tool_call_id?: string
  feedback?: string
  edited_args?: Record<string, unknown>
}
```

解释：

- 对 extension approval，`edited_args` 指真实 extension tool 的 args，不是 `callExtensionTool` wrapper args。
- 对 execute/file mutation，P0 忽略 `edited_args`。
- 如果 `type === "reject"`，忽略 `edited_args`。
- 如果 approve 但没有 `edited_args`，保持当前行为。

### 6.6 IPC schema

`agentResumeParamsSchema` 需要允许：

```ts
const hitlDecisionSchema = z
  .object({
    feedback: optionalNormalizedTrimmedStringSchema,
    request_id: nonEmptyTrimmedStringSchema,
    tool_call_id: optionalNormalizedTrimmedStringSchema,
    type: z.enum(["approve", "reject"]),
    edited_args: z.record(z.string(), z.unknown()).optional()
  })
  .strict()
```

注意：IPC schema 只做结构检查，不做业务校验。业务校验在 main resume validation。

## 7. Schema To Form 设计

### 7.1 输入

```ts
buildToolApprovalFormFromSchema({
  schema: binding.definition.inputSchema,
  values: toolArgs,
  displayHints: binding.definition.approval?.form,
  toolDisplay: binding.display
})
```

### 7.2 输出

```ts
ToolApprovalForm | null
```

如果 `approval.form === false`，返回 null。

### 7.3 类型映射

P0 支持平铺 object schema：

| Schema shape | Field | 备注 |
|---|---|---|
| `z.string()` | text | 默认 |
| `z.string().min(...)` | text required | 根据 optional/nullable 推断 required |
| `z.string()` + hint `textarea` | textarea | 用于 body/content/notes |
| `z.enum([...])` | dropdown | options 使用 enum value titleize |
| `z.boolean()` | checkbox | optional default false 时仍渲染 checkbox |
| `z.number()` / `z.int()` | number | 传递 min/max |
| `z.object(...)` | json | P0 fallback |
| `z.array(...)` | json | P0 fallback |
| union/discriminated union | json | P0 fallback |
| unsupported | json + unsupportedFields | 不丢信息 |

### 7.4 Label 规则

Label 优先级：

1. `approval.form.fields[name].label`
2. schema description
3. extension tool display metadata 中的已知字段映射
4. name titleize，例如 `repositoryFullName` -> `Repository Full Name`

P0 可以先用 1 和 4，P1 再引入 schema description。

### 7.5 默认值和 normalization

不要在 renderer 里猜默认值。main 构建 form 时应该尽量通过 schema parse 获取默认值：

```text
raw tool args
  -> schema.safeParse
  -> parsed defaulted args if success
  -> form.values
```

如果 parse 失败：

- form 仍然可以从 raw args 构建。
- review 带上 validation issues。
- approve 前必须重新 parse 成功。

## 8. Runtime 状态机

### 8.1 无编辑 approve

```text
pending approval
  -> decision approve without edited_args
  -> handler(original request)
```

这保持现有行为。

### 8.2 reject

```text
pending approval
  -> decision reject
  -> ToolMessage(status=error, content=user rejected...)
  -> agent receives rejection
```

这保持现有行为。

### 8.3 approve with edited args

```text
pending extension approval
  -> decision approve with edited_args
  -> find original HITL request by request_id/tool_call_id
  -> assert original tool is callExtensionTool
  -> resolve original extensionName/toolName
  -> resolve extension binding
  -> parse edited_args with binding.inputSchema
  -> build next call args { extensionName, toolName, args: parsedArgs }
  -> run permissionRuntime.evaluate(next call)
  -> allow:
       execute handler with next call args
  -> deny:
       return error ToolMessage
  -> require_approval:
       compare previous review and next review
       if semantically same:
         execute handler with next call args
       else:
         re-interrupt with next review
```

### 8.4 什么时候需要 re-interrupt

用户编辑后，如果审批对象发生了用户必须重新确认的变化，就重新中断：

| 变化 | 是否 re-interrupt | 原因 |
|---|---:|---|
| GitHub repo 从 `a/b` 改成 `c/d` | 是 | 目标资源变了 |
| Notion pageId 改了 | 是 | 写入目标变了 |
| Reminder title 改了 | 否 | 用户刚编辑的主体内容，approve 即确认 |
| `deleteReminder` reminderId 改了 | 是 | 删除目标变了 |
| schema trim title 空格 | 否 | 无害 normalization |
| default `limit` 被补成 25 | 否 | 无害 default |
| access 从 write 变 external | 是 | 风险类别变了 |

P0 可以先采用保守策略：只要 edited args 和 original args 不同，就重新生成 review 但不一定二次 interrupt；对目标字段使用 allowlist 决定是否二次确认。

### 8.5 并发审批

当前 middleware 已经限制同一个 assistant step 里只消费一个 approval-required action，其他并发 approval-required tool call 返回 skipped error。P0 保持这个不变量，避免多个表单同时待审导致运行时状态难以恢复。

## 9. Renderer 设计

### 9.1 新组件

新增 `ExtensionHumanInTheLoop`：

```text
ExtensionHumanInTheLoop
  ToolApprovalCard
    Header
      badge: Approval
      title: confirmation.title ?? toolTitle
      subtitle: capabilityDisplayName
    ConfirmationFacts
    ToolApprovalForm
    RawArgsDisclosure
    ToolApprovalActions
```

注册逻辑：

```ts
defineHumanInTheLoop({
  name: "callExtensionTool",
  render: renderExtensionApproval
})
```

或者通过 `request.review.kind === "extension_tool"` 在 default renderer 中分派。

### 9.2 Form 行为

Form 行为：

- 初始值来自 `request.review.form.values`。
- 用户编辑字段时只更新本地 state。
- 点击 approve 时提交 `{ type: "approve", edited_args }`。
- 如果没有 form，就提交 `{ type: "approve" }`，保持现有行为。
- json 字段需要本地 parse；parse 失败时不允许 approve，并在字段下显示错误。
- number 字段可以在本地保留 string draft，提交前转换成 number。

### 9.3 显示层级

建议卡片结构：

```text
[Approval]
Create GitHub issue
GitHub / Personal account

Action
  Repository    owner/repo
  Title         ...

Fields
  Repository    [ owner/repo          ]
  Title         [ Fix bug             ]
  Body          [ textarea            ]

Details
  Policy reason
  Raw arguments

[Reject] [Approve and Run]
```

原则：

- confirmation 在表单上方，解释用户正在批准什么。
- 表单是主要交互区域。
- raw args 是折叠 details，不是主视觉。
- access/risk tone 只用于提醒，不做恐吓式 UI。

### 9.4 错误状态

可能错误：

| 错误 | UI |
|---|---|
| 本地字段 parse 失败 | 字段下 inline error |
| main schema validation 失败 | 保留表单 draft，显示 server validation error |
| approval request 已过期 | 卡片变成 resolved/expired 状态 |
| extension binding 不存在 | 展示不可执行错误，禁用 approve |
| permission re-check deny | 展示 deny reason |

## 10. Main Process 设计

### 10.1 Approval planner

新增模块建议：

```text
src/main/extension-tools/approval-planner.ts
```

职责：

- 从 binding + args 构建 `ExtensionToolApprovalItem`。
- 调用 schema-to-form。
- 调用 confirmation builder。
- 包装 fallback。

接口：

```ts
export async function buildExtensionToolApprovalReview(input: {
  binding: ExtensionAgentToolBinding
  args: Record<string, unknown>
  decision: ExtensionPermissionDecision
  permissionMode: PermissionModeName
}): Promise<ExtensionToolApprovalItem>
```

然后 `createDynamicExtensionToolApprovalPolicyProvider.getReview` 调用它。

### 10.2 Resume validator

当前 `ToolApprovalMiddleware` 里的 `normalizeToolApprovalDecision` 只解析 decision，不处理 edited args。P0 需要在 approval approve 后增加一层：

```ts
const approvedRequest = await resolveApprovedToolCallRequest({
  originalRequest: request,
  approvalDecision,
  permissionRuntime
})

return handler(approvedRequest)
```

`resolveApprovedToolCallRequest` 负责：

- 判断是否 extension edited approval。
- 加载/解析 original call envelope。
- 找 binding。
- parse edited args。
- 重新调用 permission runtime。
- 返回新 request 或要求 re-interrupt。

### 10.3 Binding 查找

因为 edited args 不应允许修改 `extensionName/toolName`，binding 查找使用 original request：

```ts
const envelope = callExtensionToolInputSchema.parse(originalRequest.toolCall.args)
const binding = extensionToolPolicyProvider.getCallToolPolicy(originalRequest.toolCall.args)?.binding
```

不要从 `edited_args` 读取 tool identity。

### 10.4 Handler 输入替换

handler 期望的是 `request`：

```ts
{
  toolCall: {
    name: "callExtensionTool",
    args: {
      extensionName,
      toolName,
      args: parsedEditedArgs
    }
  }
}
```

所以不能只改 review payload，必须替换进入 handler 的 request。

## 11. 数据和持久化

### 11.1 不需要立即迁移

当前 `hitlRequest` 表已经有：

- `tool_args`
- `review_payload`
- `allowed_decisions`
- `decision`
- `status`

`review_payload` 和 `decision` 都可以存 JSON。P0 新增字段可以自然写入 JSON：

```json
{
  "kind": "extension_tool",
  "args": { "...": "..." },
  "form": { "...": "..." },
  "confirmation": { "...": "..." }
}
```

decision：

```json
{
  "type": "approve",
  "edited_args": { "...": "..." }
}
```

### 11.2 后续审计表

如果需要更强审计，可以 P2 增加：

```text
HitlDecisionAudit
  id
  requestId
  threadId
  runId
  toolCallId
  originalArgs
  editedArgs
  normalizedArgs
  validationStatus
  policyDisposition
  createdAt
```

P0 不建议做，避免范围膨胀。

## 12. 与现有模块的关系

| 现有模块 | 改动 |
|---|---|
| `src/shared/hitl.ts` | `HITLDecision` 增加 `edited_args` |
| `src/shared/tool-approval.ts` | 增加 form/confirmation 类型；扩展 `ExtensionToolApprovalItem` parser |
| `src/shared/extension-sources.ts` | `ExtensionToolDefinition` 增加可选 approval metadata |
| `src/main/extension-tools/permission.ts` | `getReview` 改为构建 rich review |
| `src/main/extension-tools/executor.ts` | 不直接改；继续只执行 schema parsed input |
| `src/main/agent/tool-approval-middleware.ts` | approve 后处理 edited args 和 revalidation |
| `src/main/agent/controller-schema.ts` | `agent:resume` schema 放开 `edited_args` |
| `src/renderer/src/components/chat/tools/*` | 增加 extension approval renderer 和 form fields |
| tests | 增加 schema form、edited args、validation、permission re-check 覆盖 |

## 13. 分期计划

### P0: Generic editable extension approval

目标：write/external extension tool 的 approval 卡可以显示 schema form，并允许用户编辑后执行。

任务：

1. 新增 shared form/confirmation 类型。
2. 扩展 `ExtensionToolApprovalItem`。
3. 扩展 `parseToolApprovalItem`，确保旧 payload 仍可解析。
4. 新增 schema-to-form builder，支持 flat object schema。
5. 在 `ExtensionToolApprovalPolicyProvider.getReview` 里生成 form。
6. 扩展 `HITLDecision.edited_args`。
7. 扩展 IPC resume schema。
8. middleware approve 后识别 edited args。
9. 对 edited args 执行 schema parse。
10. 对 edited args 重跑 permission。
11. 用替换后的 `callExtensionTool` args 执行 handler。
12. renderer 增加 `ExtensionHumanInTheLoop`。
13. 增加单测和组件测试。

P0 验收：

- GitHub `createIssue` 审批卡展示 repository/title/body 字段。
- Apple Reminders `createReminder` 审批卡展示 title/notes/dueDate/priority/listId 字段。
- Notion `addToPage` 审批卡展示 pageId/content/prepend/addDateDivider 字段。
- 用户修改 title 后，handler 收到修改后的 title。
- 用户把 required field 清空时，handler 不执行。
- Explore mode 下 write tool 仍然 deny。
- Ask-to-edit 下 write tool 仍然 require approval。
- 没有 form 的旧 approval 仍然 approve/reject 正常。

### P1: Tool-specific confirmation

目标：高价值工具显示业务语义确认文案。

任务：

1. `ExtensionToolDefinition.approval.confirmation`。
2. planner 调用 confirmation builder。
3. builder error fallback。
4. 为 GitHub/Notion/Reminders 写第一批 confirmation。
5. 增加 snapshot tests。

P1 验收：

- GitHub createIssue 显示“Create GitHub issue”并列出 repo/title。
- Reminder delete 显示 danger tone 和 reminderId/title。
- Notion addToPage 显示 pageId 和 append/prepend。
- confirmation builder 抛错时不影响 approval gate。

### P2: Custom approval renderer

目标：复杂工具可以拥有专用 UI。

任务：

1. 新增 approval renderer registry。
2. 支持按 `toolName` 或 `extensionName/toolName` 注册。
3. generic schema form 作为 fallback。
4. story/test fixture 渲染 approval state。
5. 支持非聊天 surfaces 处理 pending approval。

P2 验收：

- custom renderer 可覆盖 GitHub createIssue。
- generic renderer 仍处理所有未覆盖工具。
- pending approval 从 chat 外部 resolve 不丢 request identity。

## 14. 测试计划

### 14.1 Unit tests

新增测试：

| 测试 | 断言 |
|---|---|
| schema string -> text field | 生成 text field |
| enum -> dropdown | options 正确 |
| boolean default -> checkbox | 初始值正确 |
| nested object -> json | unsupportedFields 记录 |
| ExtensionToolApprovalItem parser | form/confirmation 可 roundtrip |
| edited args validation success | handler 收到 parsed edited args |
| edited args validation fail | handler 不执行 |
| permission re-check deny | handler 不执行，返回 error ToolMessage |

### 14.2 Integration tests

覆盖：

- `callExtensionTool` ask-to-edit write approval 生成 form。
- approve with edited args 执行 extension handler。
- reject 不执行 handler。
- stale/missing binding 返回 error。
- direct extension agent tool call 仍 deny。

### 14.3 Renderer tests

覆盖：

- form fields render。
- edit field 后 approve payload 包含 `edited_args`。
- json field parse error 禁用 approve。
- raw args details 可展开。
- no form fallback 使用现有 approve/reject。

## 15. 安全不变量

必须保持：

1. Renderer 传来的 `edited_args` 永远不可信。
2. Handler 只接收 schema parsed input。
3. Approval 不能修改 `extensionName` 或 `toolName`。
4. Direct extension agent tool calls 继续 deny。
5. Edited args 必须重跑 permission。
6. Validation fail 时 handler 不执行。
7. Deny 时 handler 不执行。
8. 如果目标资源变更且风险较高，必须重新展示 review。
9. 同一 assistant step 仍只消费一个 approval-required action。
10. `form: false` 不能绕过 approval，只能影响 UI。

## 16. 风险和应对

| 风险 | 应对 |
|---|---|
| Zod introspection 不稳定 | P0 只支持常见 flat object；复杂字段 json fallback |
| 用户以为改了字段但实际执行旧参数 | approve with edited args 必须替换 handler request；测试覆盖 |
| renderer validation 和 main validation 不一致 | renderer 只做辅助；main validation 是唯一权威 |
| confirmation builder 引入副作用 | 明确 side-effect free；timebox；错误 fallback |
| 自动二次确认过多 | P0 用目标字段策略，避免所有编辑都二次确认 |
| UI 太复杂 | raw args 折叠，主区域只放 confirmation + form |
| 影响现有 execute/file HITL | P0 只对 `review.kind === "extension_tool"` 开启 edited args |

## 17. 推荐实施顺序

建议先做 P0，且先选三个工具做验收样本：

1. GitHub `createIssue`
2. Apple Reminders `createReminder`
3. Notion `addToPage`

原因：

- 都是 write tool。
- 都有明确 flat schema。
- 都能体现“模型选对工具但参数需微调”的价值。
- 覆盖 text、textarea、checkbox、dropdown/optional string 等基础字段。

第一阶段不要先做 custom renderer。先把 generic schema form 和 main revalidation 做扎实，因为这是所有后续体验的安全地基。

## 18. 最终结论

Openwork 当前缺的不是 HITL，而是 extension tool 的交互协议。

现有系统已经有正确的安全闸门：

```text
ToolPermissionRuntime + ToolApprovalMiddleware + LangGraph interrupt
```

应该补的是：

```text
inputSchema -> approval form -> edited_args -> main validation -> policy re-check -> execute
```

同时引入：

```text
tool-specific confirmation
```

让用户知道自己确认的不是一段 JSON，而是一个具体业务动作。

最稳妥的技术路线是：

```text
P0: generic editable schema form
P1: domain-specific confirmation
P2: custom approval renderer
```

这样可以同时获得 CopilotKit 的 tool-rendering/HITL 架构优点、Raycast command form 的字段体验，以及 Openwork 自己现有 main-process safety gate 的安全边界。
