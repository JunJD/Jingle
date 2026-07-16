# Bug Issue 0714

Date: 2026-07-14

## 1. Packaged database smoke has two home-directory facts

- Status: open, non-blocking.
- Evidence: `scripts/audit-packaged-runtime.mjs` passes the same temporary directory as both
  `JINGLE_HOME` and `JINGLE_PACKAGED_SMOKE_HOME`. The production bootstrap resolves its database
  from `JINGLE_HOME`, while the verification `PrismaClient` constructs the same path from
  `JINGLE_PACKAGED_SMOKE_HOME`.
- Impact: the current smoke is correct because both values are identical, but the duplicate
  source of truth can drift and make the verifier inspect a different database from the one the
  packaged bootstrap initialized.
- Follow-up: make the verification client derive its database path from `JINGLE_HOME` and remove
  `JINGLE_PACKAGED_SMOKE_HOME`.
- Coverage note: the reviewed packaged-runtime audit was exercised on macOS arm64. Windows and
  Linux packaged paths remain covered by their release CI jobs rather than this local run.

## 2. Clipboard files projection still contains a stale impossible fallback

- Status: open, non-blocking; an unstaged UI hunk already removes it but is not independently
  owned for this commit.
- Evidence: the reviewed clipboard contract makes the `files` variant a non-empty tuple, while
  the committed baseline of `ClipboardChip.getClipboardIcon` still reads
  `context.files[0]?.isDirectory`.
- Impact: behavior remains correct, but the optional access weakens the newly explicit owner
  contract and can hide future producer drift during review.
- Follow-up: retain the existing direct `context.files[0].isDirectory` UI hunk when its mixed
  `ClipboardChip.tsx` batch is later isolated.
- Coverage note: the clipboard store tests cover non-empty file payload behavior, but there is no
  direct test for `filterClipboardSnapshot` projecting a fully filtered file list to `kind: none`.

## 3. Hidden Work facet can leave the sidebar in an invisible filtered state

- Status: open, non-blocking for the committed batches.
- Evidence: `LauncherAiSidebarPanel` keeps the selected Work facet filter after that facet no
  longer appears in the projected Work section, while the section and its clear affordance are
  both omitted.
- Impact: the sidebar can show no matching threads without exposing which hidden filter is still
  active or how to clear it.
- Follow-up: keep the selected facet visible until it is cleared, or reset the filter when its
  owning projection disappears.

## 4. Draft model display disagrees with runtime default selection

- Status: open, non-blocking for the committed batches.
- Evidence: `LauncherAiHeaderModelPicker` displays "Select model" when a new draft has
  `modelId=null`, while the runtime resolves that same draft to the configured default model.
- Impact: the visible execution fact disagrees with the model that will actually run.
- Follow-up: project the resolved default model into the header from the model-selection owner;
  do not invent a renderer fallback.

## 5. Sidebar projection reports contract errors during render

- Status: open, non-blocking for the committed batches.
- Evidence: `LauncherAiSidebarPanel` calls `console.error` directly while deriving its render
  projection.
- Impact: React Strict Mode or repeated renders can duplicate the same observable side effect and
  make error reporting depend on render frequency.
- Follow-up: return a typed contract issue from the projection, then report it once from the
  owning controller or event boundary.

## 6. Native file-path bridge lacks an Electron picker smoke

- Status: resolved by `e9ce709`.
- Evidence: the reviewed `9ab7684` baseline used `webUtils.getPathForFile`, but no existing smoke
  drove a real `<input type="file">` value through the context-isolated preload bridge.
- Resolution: V1 now accepts images only and reads them directly with `FileReader`; the generic
  `webUtils.getPathForFile` bridge was removed, so this cross-context path no longer exists.

## 7. Raspberry Pi baseline document is named more strongly than its evidence

- Status: resolved by `7b92a4d`.
- Evidence: the original `docs/performance/raspberry-pi-baseline-2026-07-13.md` recorded a local
  pre-existing `out/` snapshot and used the macOS-only `stat -f` command; it contained no
  Raspberry Pi hardware, OS, architecture, or runtime measurement.
- Resolution: the file is now `docs/performance/local-bundle-snapshot-2026-07-13.md`, with its
  title and measurement wording corrected while preserving the original commands and evidence.

## 8. Native attachment paths are trimmed before use

- Status: partially resolved by `e9ce709`; no longer affects newly selected attachments.
- Evidence: the reviewed `9ab7684` picker called `.trim()` on the path returned by
  `webUtils.getPathForFile`; `normalizeComposerMessageRef` still trims historical file-ref paths.
- Resolution: image-only picker attachments no longer carry a native path. Historical file refs
  are still normalized with `.trim()`, so their stored metadata can still be altered when decoded.
- Follow-up: preserve historical file-ref paths byte-for-byte if that metadata is later exposed,
  migrated, or exported; do not restore those refs into the V1 composer.

## 9. Native attachment path failures have no typed user-visible result

- Status: resolved by `e9ce709`.
- Evidence: `9ab7684` exposed `window.electron.getPathForFile` as a bare string result; thrown
  bridge errors were not caught and empty results were only written to `console.error`.
- Resolution: V1 rejects non-image attachments before submission and image data is read directly
  in the renderer, so the generic native-path capability and its untyped failure mode were removed.

## 10. Picker image IDs can collide across distinct files

- Status: open, non-blocking.
- Evidence: picker image IDs use `name:size:lastModified`, while `addAttachmentDrafts` deduplicates
  attachments by that ID.
- Impact: two distinct images from different directories with the same name, byte size, and
  modification timestamp cause the later selection to be silently omitted.
- Follow-up: define whether selecting the same physical image twice should deduplicate, then move
  identity generation to that owner. A per-selection ID avoids collisions; a content digest would
  preserve content-based deduplication.

## 11. Image-only composer retains unreachable file-draft presentation

- Status: open, non-blocking complexity debt.
- Evidence: after `e9ce709`, no live picker or clipboard producer creates a file attachment draft,
  but `LauncherAiAttachmentDraft`, `messageRefs`, and `LauncherAttachmentStrip` still retain their
  file branches.
- Impact: the dead branch makes the supported composer contract less explicit and gives future
  restore work a path to accidentally re-enable file submission without a runtime content owner.
- Follow-up: after the foreign composer-history closure settles, remove file drafts and file
  presentation from the composer owner while retaining historical `ComposerMessageRef` facts in
  their persistence/projection layer.

## 12. Image-only attachment boundaries lack direct behavior coverage

- Status: open, non-blocking test gap.
- Evidence: current checks cover types, lint, and the shared extension predicate, but no existing
  behavior test drives a picker-bypassed PDF or clipboard file through `useAiAttachments` and
  asserts that no message ref is produced.
- Impact: a later refactor could reconnect a file-draft producer while type checks remain green.
- Follow-up: when attachment behavior coverage is explicitly scheduled, add focused cases for
  picker bypass, clipboard files, and a real Electron `FileReader` image selection path.

## 13. Missing provider logos are announced as unknown providers

- Status: open, non-blocking accessibility semantics.
- Evidence: `UnknownProviderLogo` announces `Unknown model provider: ${providerId}` whenever a
  provider has no dedicated logo renderer. `ProviderId` is an open string, so valid custom
  providers enter the same branch.
- Impact: assistive technology receives the incorrect fact that a valid custom provider is
  unknown, and the English announcement bypasses the i18n owner.
- Follow-up: keep the fallback glyph decorative with `aria-hidden="true"`; if the unavailable-logo
  state must be announced, project an i18n-owned label that describes the missing logo rather than
  the provider itself.

## 14. Native extension view-stack context has no provider

- Status: open, non-blocking complexity debt.
- Evidence: after removing the unreferenced `NativeExtensionViewStackProvider`, the indexed tree
  has no `nativeExtensionViewStackContext.Provider`, while `extension-host/sdk.ts` still reads the
  context and passes it into `createNativeExtensionNavigationBridge`.
- Impact: the stack value is always `null`; `canPop` is permanently false and `push`/`pop` retain a
  branch that can only throw. This obscures the actual navigation contract.
- Follow-up: remove the orphaned context and hook, then make the renderer SDK directly express
  whether local view-stack navigation is supported instead of retaining a providerless abstraction.

## 15. Removed model-provider page leaves dead CSS tokens

- Status: resolved by `c0eeb60`.
- Evidence: after deleting `features/model-provider/model-provider-page/**`, `index.css` still
  defines `--jingle-model-badge-h`, `--jingle-model-badge-x`,
  `--jingle-model-badge-radius`, `--jingle-dialog-w-md`, and the
  `.system-model-selector-dialog` / `--jingle-dialog-w-model-selector` block. The indexed tree has
  no consumer for these declarations.
- Resolution: the six dead presentation facts were removed as an isolated cached CSS patch while
  preserving the live model-selection and dialog tokens.

## 16. Release smoke has only been executed on macOS arm64

- Status: open, non-blocking platform coverage gap.
- Evidence: `run-release-smoke.mjs` maps macOS, Linux, and Windows to their existing
  electron-builder targets, but the packaged smoke was executed only on macOS arm64 in this
  consolidation pass.
- Impact: Windows icon preparation and Linux/Windows directory packaging remain verified by code
  alignment rather than a current native runner execution.
- Follow-up: let the corresponding CI runners execute the same smoke command, or run it locally on
  those platforms before relying on it as a cross-platform release gate.

## 17. Removed API-key dialog leaves duplicate credential APIs and copy

- Status: open, non-blocking complexity debt.
- Evidence: after deleting the unreferenced `ApiKeyDialog`,
  `history-shell-store-core.ts` still defines renderer actions named `setProviderCredentials` and
  `deleteProviderCredentials` with no production caller. In `messages.ts`, every
  `apiKeyDialog` field except `cancel` is also unreferenced; `cancel` is consumed only by
  `ComposerApprovalPrompt`.
- Impact: the renderer retains a second credential mutation surface beside the active
  `ProviderTab` / `ProviderEditorDialogs` owner, plus a mostly dead copy namespace.
- Follow-up: remove the two history-shell credential actions and their unused API dependencies;
  move the approval prompt to common cancel copy, then delete the `apiKeyDialog` namespace.

## 18. Database startup test comment names a removed migration command

- Status: open, non-blocking documentation drift in a frozen test path.
- Evidence: `tests/node/db-startup-migrations.test.ts` still says the fixture has not run
  `pnpm prisma:migrate:deploy`, while the real development entry point and recovery hint now use
  `node scripts/run-prisma-jingle-db.mjs migrate deploy`.
- Impact: the comment can mislead future debugging, but it does not affect test execution.
- Follow-up: update the comment when the tests owner next edits that scenario; no behavior or
  assertion change is required.

## 19. Included-memory setting and IPC no longer have a presentation owner

- Status: open, non-blocking product and complexity follow-up.
- Evidence: memory context is now presented from checkpoint `contextInclusions` through
  `ContextEvidencePanel`. The old `IncludedMemoriesPanel` had no importer, but
  `showIncludedMemories`, `listIncludedMemoriesForRun`, and the `includedMemoriesTitle` copy remain.
- Impact: users can change a setting that the active context-evidence projection does not consume,
  while an IPC/controller/service read path remains with no renderer caller.
- Follow-up: decide whether `showIncludedMemories` controls the unified context-evidence view or
  should be removed. Then delete the orphaned run-level memory IPC path and copy; do not restore a
  second query-based presentation owner.

## 20. Model setup retains a dormant onboarding variant

- Status: open, non-blocking complexity debt.
- Evidence: after deleting the unreferenced `ModelOnboardingGuard`, the indexed tree has no
  `variant="onboarding"` caller, while `ModelSetupVariant`, the landing initial state, and related
  branches remain in `ModelSetupSurface` and `model-setup-projection`.
- Impact: the live Settings surface carries an unreachable first-run state machine with no startup
  owner.
- Follow-up: shrink model setup to its Settings contract, or let a future explicit first-run owner
  rebuild onboarding behavior. Do not preserve dormant branches as implicit compatibility.

## 21. Built-in launcher icon ownership remains optional

- Status: open, non-blocking owner debt.
- Evidence: `aiBuiltInCommandManifest` now declares the current AI command's `sparkles` icon, but
  `LauncherCommandManifest.iconName` and `LauncherIndexedCommand.iconName` remain optional, so a
  missing built-in icon is detected only later in `getLauncherIndexedCommandIcon`.
- Impact: the current sole built-in command is explicit, but a future built-in can still register
  successfully and fail or degrade only when presentation consumes it.
- Follow-up: require and validate a non-empty icon at the built-in owner boundary, project
  built-in and extension commands as distinct typed variants, and keep extension icons optional
  because extensions may legitimately provide an image asset instead.

## 22. Approval confirmation parsing still drops invalid evidence

- Status: open, non-blocking trust-boundary debt.
- Evidence: `parseToolApprovalConfirmation` silently removes malformed `facts`, treats a missing or
  non-array facts value as `[]`, drops invalid optional `message` / `mono` values, and downgrades an
  invalid `tone` to `"default"`.
- Impact: a malformed or stale approval payload can lose evidence or severity while still being
  accepted.
- Follow-up: make confirmation parsing fail closed when any provided field is outside the schema;
  require the producer-owned confirmation shape instead of partially normalizing it.

## 23. Approval change paths are only structurally validated

- Status: open, non-blocking trust-boundary debt.
- Evidence: `parseToolApprovalChanges` now rejects malformed entries as a group, but still accepts an
  empty or whitespace-only `path` because it checks only that the field is a string.
- Impact: a malformed persisted approval can present a change without an inspectable target path.
- Follow-up: require a non-empty path at the mutation-prediction owner and enforce the same contract
  in the approval codec.

## 24. Removed legacy chat components leave dead presentation assets

- Status: resolved by `95ec3d8` and `3f2a6b9`.
- Evidence: the deleted `ContextUsageIndicator`, `ModelSwitcher`, and `AgentSteps` components have
  no remaining production references, but `src/renderer/src/index.css` still defines
  `.context-usage-popover`, `.model-switcher-popover`, and `.ow-agent-steps` selectors. The
  `contextUsage` and `workspacePicker` copy groups in `src/renderer/src/lib/i18n/messages.ts` also
  have no production consumers.
- Resolution: the exact dead CSS selectors, `contextUsage` / `workspacePicker` groups, and
  `agentTasks` / `tasksCompleted` keys were removed with synthetic leaf commits while preserving
  all foreign token and copy hunks.

## 25. Memory actions do not surface refresh failures

- Status: open, non-blocking failure-visibility debt.
- Evidence: `MemoryTab` invokes archive, restore, create, accept, and reject actions with
  `void onAction`; each mutation then reloads the complete memory view without catching or
  presenting a rejected mutation or reload.
- Impact: when a mutation succeeds but the following reload fails, the durable fact has changed
  while the visible list stays stale and the user receives no feedback. The rejected promise is
  also left unhandled.
- Follow-up: give the Memory Settings owner one explicit action/load failure model that distinguishes
  mutation failure from refresh failure, disables only the in-flight action, and exposes localized
  status without introducing an optimistic second fact source.
