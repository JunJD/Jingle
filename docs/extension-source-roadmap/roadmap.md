# Extension Source Roadmap

## M0: Concept Freeze

Goal: make the boundary stable before implementation.

Tasks:

- Define Extension, Common Tool, SourceDefinition, SourceProfile, and RunSourceBinding.
- Decide storage ownership for definitions, profiles, secrets, and run evidence.
- Decide that renderer does not execute agent source tools.
- Decide that write tools use the existing approval/HITL path.

Acceptance:

- Apple Reminders, GitHub, and Translate can each be classified without ambiguity.
- The team can explain why Source is not MCP and why Skill is not Source.

## M1: Common Tool Infrastructure

Goal: extract extension capability into main/runtime-safe tools before involving the agent.

Tasks:

- Add shared types for extension tool definitions.
- Add an extension tool registry.
- Add an extension tool executor.
- Provide execution context with preferences, secrets, workspace path, thread id, and run id.
- Add schema validation for tool input and output where practical.

Acceptance:

- A human command can call a common tool through the main/runtime path.
- Tool execution does not depend on renderer state.
- Tool metadata declares read/write/external access and approval policy.

## M2: Source Middleware MVP

Goal: expose selected extension source tools to the agent.

Tasks:

- Add `createExtensionSourcesMiddleware`.
- Generate namespaced LangChain tools from selected SourceProfiles.
- Inject compact source context into `wrapModelCall`.
- Route tool calls through `ExtensionToolExecutor`.
- Omit tools for disabled or unauthenticated profiles.

Acceptance:

- A mock source tool appears in the agent tool list.
- The model sees active source descriptions.
- A disabled source does not expose tools.
- Missing auth is represented as source status, not as a callable broken tool.

## M3: Apple Reminders Vertical Slice

Goal: validate real read/write source behavior and approval.

Tasks:

- Define Apple Reminders common tools:
  - `getData`
  - `createReminder`
  - `setReminderCompleted`
  - `deleteReminder`
- Define Apple Reminders SourceDefinition.
- Create an implicit default SourceProfile.
- Extend approval middleware to inspect extension tool metadata.
- Record source usage in run evidence.

Acceptance:

- The agent can answer questions about reminders via read tools.
- Creating or completing a reminder triggers approval.
- Rejecting approval prevents execution.
- Approving continues the run and executes the tool.
- Pending approval can survive renderer refresh/reopen.

## M4: GitHub Read-Only Work Source

Goal: validate Source as real work-agent context.

Tasks:

- Extract GitHub read operations into common tools:
  - `searchIssues`
  - `searchPullRequests`
  - `searchRepositories`
  - `listNotifications`
  - `listWorkflowRuns`
- Define GitHub SourceDefinition.
- Support GitHub profile config for API base URL.
- Keep write operations out of scope for first GitHub slice.

Acceptance:

- The agent can use GitHub source to summarize open issues, PRs, notifications, or workflow failures.
- GitHub source execution does not depend on renderer command code.
- Large results are summarized or stored as artifacts instead of flooding the model context.

## M5: SourceProfile UI And Selection

Goal: make sources user-visible and selectable.

Tasks:

- Add SourceProfile storage.
- Add settings UI for enabling/disabling source profiles.
- Add per-profile enabled tool list.
- Add auth status display.
- Add agent composer source selection, starting with `@github` style selection.

Acceptance:

- Users can enable and disable sources.
- Users can choose which source profile a run should use.
- Run start resolves selected SourceProfiles in main.
- Renderer does not become the source of truth for active source state.

## M6: Durable RunSourceBinding

Goal: make source usage part of Openwork's harness.

Tasks:

- Add Prisma model or interim `Run.metadata` structure for source bindings.
- Persist selected source snapshots when a run begins.
- Attach tool call evidence to source binding where possible.
- Link write tool approvals to extension tool metadata.

Acceptance:

- A historical run can show which sources were enabled at the time.
- Later SourceProfile edits do not change historical run evidence.
- Approval records can identify extension source tool calls.

## M7: Skill + Source Linkage

Goal: compose workflow knowledge with work systems.

Tasks:

- Add optional skill frontmatter support:
  - `requiredSources`
  - `optionalSources`
- When a skill is selected, check source availability.
- Suggest connecting/enabling missing required sources.
- Keep skill instructions and source guide separate in the prompt.

Acceptance:

- A GitHub triage skill can declare GitHub as a required source.
- The agent can explain when a skill cannot run because a source is missing.
- Skills remain methodology; sources remain work context and tools.

## M8: Generic MCP / REST / Local Source Profiles

Goal: generalize only after native extension sources prove the path.

Tasks:

- Add `sourceType`:
  - `extension-native`
  - `mcp`
  - `rest-api`
  - `local-folder`
- Map MCP tools into common source tool metadata.
- Generate REST API tools with permission metadata.
- Add local folder search/read/list tools.

Acceptance:

- MCP, REST API, and local folders can be represented as SourceProfiles.
- All generated tools still pass through the same approval, guardrail, and evidence path.
- Native extension sources and generic sources share the same run binding model.

## Suggested Sequence

```txt
Week 1: M0 + M1
Week 2: M2 + M3
Week 3: M4
Week 4: M5 + M6
Week 5+: M7 + M8
```
