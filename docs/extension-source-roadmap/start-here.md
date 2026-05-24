# Start Here

Use this file when beginning implementation. It names the first practical slice and the order of edits.

## First Implementation Slice

Start with infrastructure only. Do not start with GitHub.

```txt
M0/M1/M2 thin slice:
  shared types
  extension tool registry
  extension tool executor
  unified permission mode policy
  mock source middleware test
```

This slice should prove that an extension common tool can be registered, resolved, permission-checked, and exposed to the agent runtime without touching renderer execution.

## Recommended First PR

Scope:

- Add shared extension tool/source/permission types.
- Add schema validation for profile-declared agent tool ids.
- Add registry collision validation.
- Add a minimal executor that can run a mock tool.
- Add permission mode resolver for read/write/external tools.

Avoid:

- Apple Reminders implementation.
- GitHub implementation.
- SourceProfile settings UI.
- Prisma schema changes.
- MCP/API/local source generalization.

Why:

The first PR should establish the boundary. If this boundary is clean, Apple Reminders and GitHub become ordinary integrations instead of architecture experiments.

## Recommended Second PR

Scope:

- Add `createExtensionSourcesMiddleware`.
- Inject source guide/context through `wrapModelCall`.
- Expose mock source tools to the agent.
- Route calls through the executor.
- Connect extension write tools to unified permission mode and existing approval middleware.

Avoid:

- Real external service calls.
- Source picker UI.
- Durable DB schema changes unless the middleware requires a temporary in-memory binding shape.

## Recommended Third PR

Scope:

- Implement Apple Reminders source using existing main-side service.
- Add implicit default SourceProfile.
- Validate read tool.
- Validate write tool with approval.

This is the first real vertical slice.

## Definition Of Done For The First Slice

- Renderer does not execute agent source tools.
- Tool metadata includes access and approval policy.
- Permission Mode can explain why a tool is allowed, blocked, or sent to approval.
- Source Guide is injected separately from skill instructions.
- A mock extension source tool can be called by the agent.
- The next implementation step is Apple Reminders, not more abstraction.
