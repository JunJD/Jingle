# Extension Source Architecture

## Layer Definitions

### Extension

An extension is a capability package. It may provide:

- human-facing commands
- extension runtime UI
- common tools
- source definitions
- preferences and auth configuration
- main-side services

An extension is not automatically a Source. For example, Translate may expose a reusable agent tool without becoming a durable work source.

### Common Tool

A common tool is a main/runtime-safe execution unit shared by human commands and agent source tools.

It should not depend on React, renderer state, launcher state, or extension UI callbacks.

```ts
type ExtensionToolAccess = "read" | "write" | "external"
type ExtensionToolApproval = "never" | "ask" | "always" | "mode-governed"

interface ExtensionToolDefinition<TInput, TOutput> {
  name: string
  title: string
  description: string
  access: ExtensionToolAccess
  approval?: ExtensionToolApproval
  inputSchema: unknown
  outputSchema?: unknown
  handler: (ctx: ExtensionToolContext, input: TInput) => Promise<TOutput>
}
```

Common tools are the execution kernel. Human commands call them through the extension runtime/main bridge. Agent calls them through source middleware.

### SourceDefinition

A SourceDefinition is the extension's declaration that some of its capability can appear to the agent as a work system.

```ts
interface ExtensionSourceDefinition {
  id: string
  extensionName: string
  title: string
  description: string
  /**
   * Agent-facing source guide. This is separate from skill instructions.
   * It explains when and how to use this work system.
   */
  guide: string
  defaultToolNames: string[]
  writeToolNames?: string[]
  requiredPreferenceNames?: string[]
  supportsMultipleProfiles?: boolean
}
```

It is code/manifest-level metadata. It does not store user credentials or per-run evidence.

### SourceProfile

A SourceProfile is a configured connection for a SourceDefinition.

Examples:

- Personal GitHub
- Company GitHub Enterprise
- Apple Reminders default account
- Work Linear workspace

```ts
interface SourceProfile {
  id: string
  sourceId: string
  extensionName: string
  displayName: string
  enabled: boolean
  config: Record<string, unknown>
  enabledToolNames: string[]
  defaultPermissionMode: "explore" | "ask-to-edit" | "auto"
  authStatus: "connected" | "missing" | "failed"
  createdAt: string
  updatedAt: string
}
```

SourceProfile is current user/workspace configuration. It can change over time.

### RunSourceBinding

RunSourceBinding is the durable snapshot of source usage for one run.

```ts
interface RunSourceBinding {
  id: string
  runId: string
  sourceProfileId: string
  sourceId: string
  extensionName: string
  displayNameSnapshot: string
  enabledToolNamesSnapshot: string[]
  permissionModeSnapshot: string
  authStateSnapshot: string
  sourceVersion: string
  createdAt: string
}
```

This belongs to the harness evidence chain. It should survive later edits to SourceProfile.

## Permission Mode

Permission Mode is a user-facing product concept that should drive all tool authorization.

It should sit above individual tool implementations:

```txt
Permission Mode
  -> permission resolver
  -> allow / require approval / deny
  -> existing HITL and guardrail flow
```

Initial modes:

```txt
Explore
  read-only.
  read tools are allowed.
  write/external tools are denied or ask the user to switch mode.

Ask to Edit
  read tools are allowed.
  write/external tools require durable HITL approval.

Auto
  trusted write/external tools can run without approval.
  guardrails still apply.
```

The same resolver should cover:

- shell commands classified through just-bash and command classifiers
- file mutation tools
- extension common tools
- future generated MCP/API tools

Tool metadata should be simple:

```txt
access: read | write | external
approval: mode-governed | never | ask | always
```

The resolver combines:

```txt
tool access
tool approval metadata
active Permission Mode
source profile defaults
run-level overrides
guardrail decision
```

The output should be the same shape Openwork already understands:

```txt
allow
require_approval
deny
```

This keeps permission product language unified while still letting the existing approval middleware remain the durable interception point.

## Source Guide

Source Guide is part of SourceDefinition from the start.

It is not a Skill. It should answer:

- what work system this source represents
- when the agent should use it
- which tools are read/write/external
- source-specific conventions and constraints
- when to ask the user before acting

First version can be code/manifest-provided. Later versions may allow per-profile user override.

Source Guide should be injected separately from Skill instructions so the model can distinguish:

```txt
Source Guide
  "How to use GitHub as a work system."

Skill
  "How to triage bugs or review PRs."
```

## Runtime Flow

```txt
User selects @github or default sources
  -> AgentService begins run
  -> SourceProfile selection is resolved in main
  -> RunSourceBinding snapshot is persisted
  -> createExtensionSourcesMiddleware receives bindings
  -> middleware injects source guide + source tools
  -> model calls ext__github__searchIssues
  -> ExtensionToolExecutor validates and executes common tool
  -> write tools pass through approval middleware
  -> results and approvals enter run evidence
```

## Middleware Shape

`createExtensionSourcesMiddleware` should do three things:

1. Register tools generated from selected SourceProfiles.
2. Inject a compact source context into the model call.
3. Route extension tool execution through `ExtensionToolExecutor`.

Generated tool names should be stable and namespaced:

```txt
ext__github__searchIssues
ext__appleReminders__createReminder
```

The registry maps generated names back to:

```txt
extensionName + sourceId + profileId + toolName
```

## Storage Boundary

```txt
SourceDefinition
  code / manifest

SourceProfile
  local settings or dedicated source config store

Secrets
  Keychain / safeStorage / secure main-process storage

RunSourceBinding
  SQLite / Prisma

Tool result artifacts
  DB summary + artifact/file reference
```

Do not store secrets in normal extension preferences or run evidence.

## Non-Goals

- Do not turn every extension into a Source.
- Do not make MCP the Source abstraction.
- Do not execute agent tools in renderer.
- Do not build generic REST/MCP Source before Apple Reminders and GitHub prove the vertical path.
- Do not let current SourceProfile changes rewrite historical run truth.
- Do not include agent-guided source setup in the current roadmap.
- Do not include inbox, source-triggered automations, or work queue design in this roadmap.
- Do not make Skill `requiredSources` part of the first source implementation.
