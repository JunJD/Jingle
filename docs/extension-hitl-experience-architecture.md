# Extension HITL Experience Architecture

> Note: this document describes a lower-level schema-form/editable-approval
> interaction. For the higher-level product and protocol direction, where
> extension HITL is driven by entity/action proposals rather than raw tool
> arguments, see
> [extension-action-proposal-protocol-cn.md](./extension-action-proposal-protocol-cn.md).

## Goal

Improve Openwork extension human-in-the-loop (HITL) from a binary approval card into a schema-driven review and edit experience.

The target experience is:

```text
agent selects extension tool
  -> Openwork policy decides whether approval is required
  -> user sees a purpose-built confirmation + editable form
  -> user approves, rejects, or edits fields
  -> main process validates and re-checks policy
  -> tool handler executes only after the reviewed payload is safe
```

This keeps the existing safety model, while adding the form-like interaction that Raycast command pages and CopilotKit-style HITL make feel natural.

## Current Openwork State

Openwork already has a solid platform-level HITL foundation:

- Extension tools declare `access`, `inputSchema`, `title`, `description`, and `handler` through `ExtensionToolDefinition` in `src/shared/extension-sources.ts`.
- `ToolApprovalMiddleware` wraps every tool call and blocks before the real handler runs.
- `ToolPermissionRuntime` decides `allow`, `deny`, or `require_approval`.
- `callExtension` approval is resolved through `ExtensionToolApprovalPolicyProvider`, which maps the generic call to the underlying extension tool binding.
- `ToolApprovalItem.kind === "extension_tool"` stores access, args, capability display name, reason, tool name, and title.
- Renderer HITL components currently render approval cards with approve/reject actions.

The gap is equally clear:

- `HITLDecision` supports only `approve`, `reject`, and optional feedback.
- Extension HITL review has no form model.
- The renderer can display raw arguments, but the user cannot safely edit them.
- Tool-specific confirmation text is generated generically from policy/access, not from business semantics.
- Existing `ToolApprovalActions` has `canEdit/onEdit`, but no data protocol exists behind it.

In short: Openwork has a strong approval gate, but it lacks a tool interaction protocol.

## CopilotKit Lessons

CopilotKit's README positions the product as a frontend stack for agents, generative UI, shared state, and HITL workflows. The architecture point to borrow is not the visual style; it is the way tool calls, rendering, and user responses are part of one interaction loop.

Three CopilotKit patterns matter for Openwork:

| Pattern | CopilotKit idea | Openwork adaptation |
|---|---|---|
| Tool rendering | Tool calls can render React UI in the message stream. | Extension approval cards should be renderer-resolved by tool/capability, with a generic fallback. |
| `useHumanInTheLoop` | The LLM calls a frontend tool with parameters; the UI renders from args and returns a response through `respond`. | For extension tools, approval UI should render from the tool schema and return structured approved args. |
| `useInterrupt` | Runtime/graph code can force a checkpoint and resume with a payload. | Keep our LangGraph interrupt-based approval gate for deterministic safety decisions. |

The conclusion:

```text
Openwork should keep interrupt-based approval for safety,
but add tool-rendering and schema-form semantics inside the approval payload.
```

This gives us CopilotKit's composable UX without weakening Openwork's platform-owned permission boundary.

References:

- [CopilotKit README](https://github.com/CopilotKit/CopilotKit/blob/main/README.md)
- [CopilotKit tool-based HITL with `useHumanInTheLoop`](https://docs.showcase.copilotkit.ai/llamaindex/human-in-the-loop)
- [CopilotKit interrupt-based HITL with `useInterrupt`](https://docs.showcase.copilotkit.ai/crewai-crews/human-in-the-loop/useInterrupt)

## Design Principles

1. **Policy stays in main.** Renderer edits are never trusted. Main validates, normalizes, and re-evaluates before execution.
2. **Approval is for a concrete payload.** If the payload changes, the reviewed plan must be regenerated.
3. **Tool authors can improve presentation, but not bypass policy.** Extension metadata may explain an action; only platform code decides allow/deny/approval.
4. **Generic first, custom later.** Most tools should get a decent form from `inputSchema` without writing UI.
5. **Complex schema falls back safely.** Unsupported fields render as read-only JSON or a raw editor with validation.
6. **One mental model.** Extension command forms and extension approval forms should share field primitives and validation behavior where possible.

## Target Architecture

```text
ExtensionToolDefinition
  inputSchema
  approval metadata (optional)
       |
       v
ExtensionApprovalPlanner
  parse callExtension args
  resolve binding
  validate draft args when possible
  derive confirmation
  derive schema form
  attach policy decision
       |
       v
ToolApprovalMiddleware
  interrupt({ review: ExtensionToolApprovalItem })
       |
       v
Renderer HITL Surface
  confirmation summary
  editable schema form
  raw args/details
  approve/reject
       |
       v
agent:resume
  HITLDecision { type, edited_args? }
       |
       v
Main Resume Validation
  validate edited args
  re-run policy
  regenerate review if target/risk changed
  execute handler or re-interrupt
```

### 1. Extension Tool Contract

Add optional approval metadata to extension tools:

```ts
export interface ExtensionToolApprovalDefinition<TInput = unknown> {
  confirmation?: ExtensionToolConfirmationBuilder<TInput>
  form?: "auto" | false | ExtensionToolApprovalFormDefinition
  riskLabel?: "write" | "external" | "destructive"
}

export type ExtensionToolConfirmationBuilder<TInput> = (
  input: TInput,
  context: ExtensionToolConfirmationContext
) => ExtensionToolConfirmation | Promise<ExtensionToolConfirmation>

export interface ExtensionToolConfirmation {
  title?: string
  message?: string
  tone?: "default" | "warning" | "danger"
  facts?: Array<{ label: string; value: string }>
}
```

This builder must be side-effect free. It can format the proposed action, but it must not call remote APIs or mutate user data.

Existing tools continue to work because the default is `form: "auto"` for write/external tools.

### 2. Approval Payload

Extend `ExtensionToolApprovalItem`:

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
  facts: Array<{ label: string; value: string }>
}

export interface ToolApprovalForm {
  schemaVersion: 1
  fields: ToolApprovalField[]
  values: Record<string, unknown>
  unsupportedFields?: string[]
}
```

P0 field types:

```ts
type ToolApprovalField =
  | { type: "text"; name: string; label: string; required?: boolean; placeholder?: string }
  | { type: "textarea"; name: string; label: string; required?: boolean; rows?: number }
  | { type: "number"; name: string; label: string; required?: boolean; min?: number; max?: number }
  | { type: "checkbox"; name: string; label: string }
  | { type: "dropdown"; name: string; label: string; required?: boolean; options: ToolApprovalOption[] }
  | { type: "json"; name: string; label: string; required?: boolean }
```

`json` is a safe fallback for nested objects, arrays, and unsupported unions.

### 3. Schema To Form

Build a main-process utility:

```ts
buildToolApprovalFormFromSchema({
  schema: binding.definition.inputSchema,
  values: args,
  displayHints: binding.definition.approval?.form
})
```

P0 conversion rules:

| Zod/JSON schema shape | Field |
|---|---|
| string | text |
| string with long content hint | textarea |
| enum string | dropdown |
| boolean | checkbox |
| number/integer | number |
| nullable/optional | optional field |
| object/array/union | json fallback |

Labels come from this precedence:

1. explicit approval form metadata
2. schema description
3. tool display metadata
4. field name converted to title case

Defaults should be resolved through the same schema parsing path used before handler execution, not through ad hoc renderer logic.

### 4. Resume With Edited Args

Extend `HITLDecision`:

```ts
export interface HITLDecision {
  type: "approve" | "reject"
  request_id?: string
  tool_call_id?: string
  feedback?: string
  edited_args?: Record<string, unknown>
}
```

For extension approvals, `edited_args` means the underlying extension tool args, not the wrapper `callExtension` envelope.

Example:

```ts
{
  type: "approve",
  request_id: "hitl:...",
  tool_call_id: "call-1",
  edited_args: {
    repositoryFullName: "openwork/openwork",
    title: "Fix approval form",
    body: "..."
  }
}
```

Main then reconstructs:

```ts
{
  extensionName: original.extensionName,
  toolName: original.toolName,
  args: edited_args
}
```

### 5. Revalidation And Re-approval

Approval after editing must run through a deterministic state machine:

```text
pending approval
  -> user rejects
       -> return rejected ToolMessage
  -> user approves without edits
       -> execute original handler
  -> user approves with edits
       -> parse edited args with inputSchema
       -> re-run extension permission policy
       -> rebuild confirmation/form
       -> compare approval-sensitive summary
       -> execute or re-interrupt
```

Re-interrupt when:

- tool identity changes
- access category changes
- destructive target changes
- confirmation builder returns a different danger-level action
- schema validation normalizes fields in a way that changes user-visible target

Do not re-interrupt for harmless normalization such as trimming whitespace or applying default `limit`.

### 6. Renderer Layer

Add a dedicated `ExtensionHumanInTheLoop` renderer:

```text
ToolApprovalCard
  header: capability + action + access tone
  confirmation: title/message/facts
  form: schema fields + local validation
  details: raw args / policy reason
  actions: reject, approve and run
```

This renderer should:

- use the same form field primitives as command pages where practical
- preserve local draft state while the user edits
- show validation errors returned by main on resume failure
- collapse raw JSON by default
- keep unsupported fields visible

Later, add a CopilotKit-like renderer registry:

```ts
registerToolApprovalRenderer({
  toolName: "ext__github__createIssue",
  render: GitHubCreateIssueApproval
})
```

The generic schema form remains the fallback for all tools.

## Example Tool Experiences

### GitHub `createIssue`

Form fields:

- Repository
- Title
- Body

Confirmation:

```text
Create GitHub issue
Repository: owner/repo
Title: Fix extension HITL form
```

Approve executes only after `repositoryFullName` still matches the schema.

### Apple Reminders `createReminder`

Form fields:

- Title
- Notes
- Due date
- Priority
- List id

Confirmation:

```text
Create reminder
Title: Pay invoice
Priority: high
```

### Notion `addToPage`

Form fields:

- Page id
- Content
- Prepend
- Add date divider

Confirmation:

```text
Add content to Notion page
Page: <page id>
Mode: append/prepend
```

## Implementation Plan

### P0: Generic Editable Extension Approval

Scope:

- write/external extension tools only
- generic schema-derived form
- no custom React approval renderers
- no remote preview calls

Tasks:

1. Add shared approval form and confirmation types.
2. Extend `ExtensionToolApprovalItem` with `form` and `confirmation`.
3. Add `buildToolApprovalFormFromSchema` for flat Zod object schemas.
4. Update `ExtensionToolApprovalPolicyProvider.getReview` to include form data.
5. Extend `HITLDecision` and `agent:resume` IPC schema with `edited_args`.
6. Update approval resume handling to substitute edited extension args before handler execution.
7. Re-run `parseToolInputWithSchema` and permission evaluation after edits.
8. Add `ExtensionHumanInTheLoop` renderer with editable fields.
9. Add tests for GitHub `createIssue`, Apple Reminders `createReminder`, and Notion `addToPage`.

P0 acceptance:

- A write extension tool approval shows editable fields instead of raw args only.
- Editing a field changes the executed payload.
- Invalid edits do not execute the handler.
- Explore mode still denies write tools.
- Ask-to-edit still requires approval after edits.
- Auto mode behavior remains unchanged unless the tool explicitly requests approval.

### P1: Tool-Specific Confirmation

Scope:

- serializable confirmation builders
- better messages and facts for high-value tools
- risk tone support

Tasks:

1. Add `approval.confirmation` to `ExtensionToolDefinition`.
2. Timebox and error-isolate confirmation builders.
3. Implement confirmations for:
   - GitHub `createIssue`
   - Apple Reminders `deleteReminder`
   - Apple Reminders `completeReminder`
   - Notion `addToPage`
   - Notion `createDatabasePage`
4. Add snapshot tests for confirmation payloads.

P1 acceptance:

- Destructive/external actions show domain-specific targets.
- Missing confirmation falls back to generic form safely.
- A broken confirmation builder does not block policy enforcement.

### P2: Custom Approval Renderers And Headless Resolution

Scope:

- custom UI for complex tools
- renderer registry by tool name and wildcard
- optional non-chat approval surfaces

Tasks:

1. Add renderer registry similar to existing tool component registry.
2. Allow extension/capability-specific approval renderers in renderer code.
3. Add headless resolver API for sidebar/global approval surfaces.
4. Add story/test fixtures to render approval states without running an agent.

P2 acceptance:

- Generic renderer handles every tool.
- Custom renderer can override a single tool.
- Approval can be resolved from a non-chat surface without losing request identity.

## Data And Persistence Notes

The current `hitlRequest` table already stores `review_payload` and `decision` as serialized JSON. P0 likely does not require a DB migration if the new fields live inside those JSON payloads.

IPC and runtime types do need changes:

- `HITLDecision.edited_args`
- `agentResumeParamsSchema`
- `ToolApprovalDecision`
- middleware resume normalization

If we later need auditing by field, add a separate table:

```text
HitlDecisionAudit
  requestId
  originalArgs
  editedArgs
  normalizedArgs
  validationStatus
  policyDisposition
```

Do not add this in P0 unless compliance/audit needs force it.

## Security Invariants

- Renderer-sent `edited_args` is untrusted input.
- Handler execution must only receive schema-parsed args.
- Approval cannot change `extensionName` or `toolName`.
- Direct extension agent tool calls remain denied; execution still goes through `callExtension`.
- Edited args must re-run permission policy.
- If revalidation fails, no tool handler runs.
- If approval-sensitive target changes after normalization, the user must see the regenerated review.
- Concurrent approval behavior remains one approval-required action per assistant step.

## Open Questions

1. Should `auto` mode still bypass editable review for write extension tools, or should extensions be able to force review for selected destructive tools?
2. Do command-page form primitives already expose enough validation state to reuse directly, or should approval form maintain a lighter renderer-owned implementation?
3. Should schema descriptions become user-facing labels, or should we require explicit display metadata for all P0 write tools?
4. Should edited approval args be visible in chat history after execution for auditability?

## Recommendation

Implement P0 before adding more extension tools.

The practical reason is that GitHub, Notion, and Reminders write tools all share the same UX risk: the model may choose the right tool but slightly wrong arguments. A binary approve/reject card forces the user to cancel and re-prompt. A schema-form HITL lets the user correct the payload in place, while Openwork keeps the existing permission and validation boundary.

This is the right architectural blend:

```text
CopilotKit-style tool rendering and structured response
+ Openwork's platform-owned interrupt approval gate
+ Raycast-like form primitives
= extension HITL that is both usable and safe
```
