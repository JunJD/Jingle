# Task Breakdown

This checklist is intentionally implementation-oriented. It should be updated as work lands.

## Foundation

- [x] Create shared extension tool types.
- [x] Create shared extension source types.
- [x] Define shared Permission Mode names and internal policy values.
- [ ] Decide whether initial SourceProfile storage uses existing preferences/electron-store or a dedicated source profile store.
- [x] Decide whether first RunSourceBinding lands in Prisma schema or `Run.metadata`.
- [x] Add schema validation for externally declared agent tool ids.
- [x] Add collision checks for extension tool names and profile-declared agent tool ids.

## Extension Tool Registry

- [x] Add `src/main/extension-tools/registry.ts`.
- [x] Register tools from installed native extension main definitions.
- [x] Validate that every tool belongs to a known extension.
- [x] Validate that tool names are unique within extension scope.
- [x] Provide lookup by profile-declared agent tool id.
- [x] Provide metadata lookup for approval middleware.

## Extension Tool Executor

- [x] Add `src/main/extension-tools/executor.ts`.
- [x] Validate input schema before execution.
- [ ] Resolve extension preferences in main.
- [ ] Resolve secrets through secure storage.
- [x] Pass `threadId`, `runId`, `workspacePath`, and `sourceProfileId` into handlers.
- [ ] Normalize tool success/error output.
- [x] Define a bounded output contract so tools do not flood model context.

## Unified Permission Mode

- [x] Define `explore`, `ask-to-edit`, and `auto` as product-level modes.
- [x] Map existing execute command policy to unified permission decisions.
- [x] Keep just-bash mutation prediction as an input to command permission policy.
- [x] Add extension tool permission resolver.
- [x] Resolve extension tool policy from access, approval metadata, active mode, and source profile defaults.
- [x] Store SourceProfile default permission mode.
- [x] Snapshot permission mode into run metadata for the first source-tool slice.
- [x] Add tests for read/write/external tool policy under each mode.

## Source Middleware

- [x] Add a runtime composition point that owns source tool bindings, middleware, and approval policy provider together.
- [x] Add `src/main/agent/extension-sources-middleware.ts`.
- [x] Build LangChain tools from active SourceProfiles.
- [x] Inject active source context through `wrapModelCall`.
- [x] Exclude disabled profiles.
- [x] Exclude or deny write tools when Permission Mode requires read-only behavior.
- [x] Represent missing auth as status text, not callable tools.
- [x] Add unit tests for prompt injection and tool generation.

## Approval, Permission, And Guardrails

- [x] Route execute, desktop automation, file mutation, and extension source policy through one tool permission runtime.
- [x] Extend approval middleware to recognize extension source agent tool ids after Permission Mode resolution.
- [x] Map agent tool id to source tool metadata.
- [x] Require approval for `approval: "always"` and `ask-to-edit` write/external decisions.
- [x] Treat write/external tools as mode-governed by default.
- [x] Link approval request to source profile and extension tool metadata.
- [x] Keep pending approval scoped to one `toolCallId`; do not introduce multi-action approval groups in the first source-tool path.
- [x] Replace the composer input with the approval prompt while a run is blocked on user approval.
- [ ] Decide whether guardrail provider needs source-specific context.

## Apple Reminders Slice

- [x] Move or wrap existing main-side Apple Reminders RPC methods as common tools.
- [x] Add Apple Reminders SourceDefinition.
- [x] Add implicit default Apple Reminders SourceProfile.
- [x] Expose read tool to agent.
- [x] Expose write tools with approval.
- [ ] Add a BDD scenario for creating a reminder through agent approval.
- [ ] Add a BDD scenario for rejected reminder creation.

## GitHub Slice

- [ ] Extract GitHub read operations from renderer/client into main/runtime-safe common tools.
- [ ] Add GitHub SourceDefinition.
- [ ] Add GitHub SourceProfile publicConfig for API base URL.
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

- [x] Persist RunSourceBinding at run start.
- [x] Store display name, enabled tools, permission mode, auth state, and source version snapshot.
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

- [x] Unit test tool registry collision handling.
- [x] Unit test source profile selection.
- [x] Unit test agent tool id validation and collision handling.
- [x] Unit test approval metadata resolution.
- [x] Integration test mock extension source tool execution.
- [ ] BDD test Apple Reminders approval flow.
- [ ] BDD test GitHub read-only work source.
- [x] Typecheck after each implementation slice.
