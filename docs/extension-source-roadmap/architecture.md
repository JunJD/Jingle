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
type ExtensionToolApproval = "never" | "ask" | "always"

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
