# Research Notes

## Craft Agents

Craft Agents treats Sources as first-class work context. The important lesson is not "use MCP"; it is "make external work systems visible, configurable, permissioned, and usable by the agent."

Relevant observed design:

- Source types include MCP servers, REST APIs, and local files.
- Source folders contain `config.json` and `guide.md`.
- Source configuration includes auth state and connection status.
- Source usage can be selected per session.
- Skills can declare `requiredSources`.
- Permissions are configurable around tools, APIs, and local actions.

This supports the Openwork direction of making Source an agent-facing projection of extension capability.

## MCP

MCP is a protocol-level way to expose tools, resources, and prompts. It can back a Source, but it is not the Source abstraction itself.

Useful mapping:

```txt
MCP tool
  -> generated source tool

MCP resource
  -> source-readable context or artifact

MCP server
  -> one possible SourceProfile backend
```

Openwork should not force native extension sources to become MCP servers. Native common tools can be more direct and safer.

## Openwork Current Fit

Openwork already has the main structures needed for this design:

- Agent runtime middleware pipeline.
- Tool injection through LangChain/deepagents middleware.
- Tool approval middleware.
- Guardrail middleware.
- Durable runs, checkpoints, and HITL requests.
- Native extension manifests, preferences, RPC, and main-side services.
- Extension runtime snapshot protocol that keeps renderer out of execution truth.

The missing pieces are:

- extension common tool definitions
- extension tool registry
- extension tool executor
- source profile selection
- source middleware
- run source evidence

## Important Local Anchors

- `src/main/agent/runtime.ts`: current middleware assembly.
- `src/main/agent/tool-approval-middleware.ts`: approval interception point.
- `src/main/agent/guardrail-middleware.ts`: guardrail interception point.
- `src/shared/native-extensions.ts`: current extension manifest types.
- `src/shared/extension-runtime-protocol.ts`: runtime host request protocol.
- `src/main/services/extension-runtime/host-capabilities.ts`: main-side extension host capabilities.
- `src/extensions/apple-reminders/main/service.ts`: good first source because main-side service already exists.
- `src/extensions/github/main.ts`: currently empty main definition, which makes GitHub a good second slice after common tool extraction.

## Product Judgment

The right product shape is:

```txt
Extension = capability package
Source = agent-facing work system projection
Skill = method/workflow knowledge
Common Tool = shared execution unit
Middleware = runtime injection mechanism
Harness = durable truth and evidence
```

If these layers collapse into one abstraction, Openwork becomes harder to reason about and harder to verify.
