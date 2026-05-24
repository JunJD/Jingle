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

Permission Mode is the most relevant product-language lesson from Craft for the current Openwork roadmap. It turns low-level permission mechanics into user-understandable modes. Openwork already has command classification, just-bash mutation prediction, guardrails, and HITL approvals; the opportunity is to put one product-level mode system above all of them.

Source Guide is already part of the proposed SourceDefinition. It should remain separate from Skill instructions.

Skill `requiredSources` is a useful new concept, but it should be treated as later concept validation. It should not block the first Source implementation.

## MCP

MCP is a protocol-level way to expose tools, resources, and prompts. It can back a Source, but it is not the Source abstraction itself.

Useful mapping:

```txt
MCP tool
  -> profile-declared source tool

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
- unified Permission Mode for extension tools
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

## Current Non-Scope

Do not include these in the current implementation roadmap:

- agent-guided source setup
- inbox/work queue
- source-triggered automations

They may be revisited later, but the current roadmap should stay focused on Source, Common Tool, Permission Mode, Source Guide, and durable run evidence.
