# Task Breakdown

This checklist is intentionally implementation-oriented. It should be updated as work lands.

## Foundation

- [ ] Create shared extension tool types.
- [ ] Create shared extension source types.
- [ ] Define shared Permission Mode names and internal policy values.
- [ ] Decide whether initial SourceProfile storage uses existing preferences/electron-store or a dedicated source profile store.
- [ ] Decide whether first RunSourceBinding lands in Prisma schema or `Run.metadata`.
- [ ] Add naming helpers for generated agent tool names.
- [ ] Add collision checks for extension tool names and generated source tool names.

## Extension Tool Registry

- [ ] Add `src/main/extension-tools/registry.ts`.
- [ ] Register tools from installed native extension main definitions.
- [ ] Validate that every tool belongs to a known extension.
- [ ] Validate that tool names are unique within extension scope.
- [ ] Provide lookup by generated agent tool name.
- [ ] Provide metadata lookup for approval middleware.

## Extension Tool Executor

- [ ] Add `src/main/extension-tools/executor.ts`.
- [ ] Validate input schema before execution.
- [ ] Resolve extension preferences in main.
- [ ] Resolve secrets through secure storage.
- [ ] Pass `threadId`, `runId`, `workspacePath`, and `sourceProfileId` into handlers.
- [ ] Normalize tool success/error output.
- [ ] Define a bounded output contract so tools do not flood model context.

## Unified Permission Mode

- [ ] Define `explore`, `ask-to-edit`, and `auto` as product-level modes.
- [ ] Map existing execute command policy to unified permission decisions.
- [ ] Keep just-bash mutation prediction as an input to command permission policy.
- [ ] Add extension tool permission resolver.
- [ ] Resolve extension tool policy from access, approval metadata, active mode, and source profile defaults.
- [ ] Store SourceProfile default permission mode.
- [ ] Snapshot permission mode into RunSourceBinding.
- [ ] Add tests for read/write/external tool policy under each mode.

## Source Middleware

- [ ] Add `src/main/agent/extension-sources-middleware.ts`.
- [ ] Build LangChain tools from active SourceProfiles.
- [ ] Inject active source context through `wrapModelCall`.
- [ ] Exclude disabled profiles.
- [ ] Exclude or deny write tools when Permission Mode requires read-only behavior.
- [ ] Represent missing auth as status text, not callable tools.
- [ ] Add unit tests for prompt injection and tool generation.

## Approval, Permission, And Guardrails

- [ ] Extend approval middleware to recognize generated extension source tool names after Permission Mode resolution.
- [ ] Map generated tool name to source tool metadata.
- [ ] Require approval for `approval: "always"` and `ask-to-edit` write/external decisions.
- [ ] Treat write/external tools as mode-governed by default.
- [ ] Link approval request to source profile and extension tool metadata.
- [ ] Decide whether guardrail provider needs source-specific context.

## Apple Reminders Slice

- [ ] Move or wrap existing main-side Apple Reminders RPC methods as common tools.
- [ ] Add Apple Reminders SourceDefinition.
- [ ] Add implicit default Apple Reminders SourceProfile.
- [ ] Expose read tool to agent.
- [ ] Expose write tools with approval.
- [ ] Add a BDD scenario for creating a reminder through agent approval.
- [ ] Add a BDD scenario for rejected reminder creation.

## GitHub Slice

- [ ] Extract GitHub read operations from renderer/client into main/runtime-safe common tools.
- [ ] Add GitHub SourceDefinition.
- [ ] Add GitHub SourceProfile config for API base URL.
- [ ] Move GitHub token handling toward secure main-side storage.
- [ ] Expose read-only GitHub tools to agent.
- [ ] Add result size control for GitHub search/list calls.
- [ ] Add a BDD scenario for summarizing GitHub PR or workflow state.

## SourceProfile UI

- [ ] Add source profile listing to settings.
- [ ] Add enable/disable toggle.
- [ ] Add profile auth status.
- [ ] Add enabled tool list per profile.
- [ ] Add default permission mode per profile.
- [ ] Add source picker in agent composer.
- [ ] Persist selected source profiles when starting a run.

## Run Evidence

- [ ] Persist RunSourceBinding at run start.
- [ ] Store display name, enabled tools, permission mode, auth state, and source version snapshot.
- [ ] Add optional RunExtensionToolCall evidence model or metadata.
- [ ] Show source usage in run/history UI.
- [ ] Verify historical run display is stable after SourceProfile changes.

## Skill Linkage Concept

- [ ] Write down whether `requiredSources` belongs in skill metadata or a higher-level workflow descriptor.
- [ ] Prototype `requiredSources` only after SourceProfile selection is stable.
- [ ] Do not block Apple Reminders or GitHub slices on this concept.
- [ ] Keep source guide and skill guide as separate prompt sections.

## Deferred Generic Source Types

- [ ] Define `sourceType: "extension-native" | "mcp" | "rest-api" | "local-folder"`.
- [ ] Decide whether generic MCP/REST/local sources are built-in extensions or a separate source manager.
- [ ] Map MCP tools to common tool metadata.
- [ ] Map REST API endpoints to generated tools.
- [ ] Add permission metadata to generated REST/API tools.
- [ ] Add local folder read/search/list tools.

## Verification

- [ ] Unit test tool registry collision handling.
- [ ] Unit test source profile selection.
- [ ] Unit test generated tool names.
- [ ] Unit test approval metadata resolution.
- [ ] Integration test mock extension source tool execution.
- [ ] BDD test Apple Reminders approval flow.
- [ ] BDD test GitHub read-only work source.
- [ ] Typecheck after each implementation slice.
