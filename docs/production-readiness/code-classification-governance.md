# Code Classification Governance

Last audited from the local checkout on 2026-06-13.

This document defines classification boundaries for production cleanup. It is a
governance proposal, not a directory migration plan. Do not move code just
because a table says a class exists; move only when owner, usage, and validation
are clear.

## Classification Rules

| Class                   | Definition                                                                       | Owner paths                                                                                                                                    | Failure semantics                                                                                                      | Validation                                                                                   |
| ----------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Product runtime         | Code that ships in the desktop app or npm runtime and affects real user behavior | `src/main`, `src/preload`, `src/renderer/src`, `src/shared`, `src/extension-runtime`, `packages/extension-api`, first-party extension packages | Fail visibly through IPC errors, UI errors, local logs, or tests. Do not hide contract failures with UI fallback.      | `npm run typecheck`, targeted node tests, BDD for user workflows, app smoke                  |
| Dev tooling             | Scripts and docs used to develop, migrate, debug, package, or release            | `scripts`, `.agents`, `.github`, dev docs, `packages/extension-cli`, `packages/extension-migration`                                            | Fail with actionable command output. Tooling drift must not be documented as a product limitation.                     | Script smoke, `npm run doctor`, `npm run check:guardrails`, packaging dry run when relevant  |
| Tests                   | Behavior and unit checks, fixtures, test-only harnesses                          | `tests/bdd`, `tests/node`, test configs                                                                                                        | Tests should isolate local user state through `OPENWORK_HOME` and fail at the behavior boundary they claim to protect. | `npm run typecheck:bdd`, `npm run typecheck:node-tests`, `npm run test:node`, targeted BDD   |
| Docs/content            | User help, dev docs, release runbooks, launch/blog drafts                        | `docs/help`, `docs/production-readiness`, `docs`, `docs/blog-drafts`, launch assets                                                            | Docs must state whether they are current contract, user guide, research, or content draft.                             | Link/code-reference check, command verification, reviewer spot-check                         |
| Deprecated/experimental | Historical research, retired migration experiments, local-only preview artifacts | future archive folder or explicit archive sections; local ignored folders                                                                      | Must not be indexed as current production truth.                                                                       | Search index/docs index check; no product imports or package scripts depend on retired paths |

## Current Runtime Ownership

| Runtime area                                                           | Keep owner                                                                                                                                                                                        | Keep boundary                                                                                                                               | Move/delete recommendation                                                                                                   |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| App lifecycle, windows, protocol, database init, native island startup | `src/main/index.ts`, `src/main/windows`, `src/main/composition-root.ts`                                                                                                                           | Main process owns lifecycle and dependency composition. Renderer should enter through `window` query and preload IPC only.                  | Keep. Do not split lifecycle until there is a concrete duplicated owner problem.                                             |
| IPC modules and services                                               | `src/main/*/{module,controller,service,repository}.ts`, `src/main/services/*`                                                                                                                     | Service owns behavior, controller owns IPC validation/registration, repository owns persistence when present.                               | Keep. When docs refer to a feature, point to module/controller/service owner paths.                                          |
| Renderer window roots                                                  | `src/renderer/src/main.tsx`, `src/renderer/src/main-window`, `src/renderer/src/launcher-shell`, `src/renderer/src/ai-core`, `src/renderer/src/settings`                                           | `main.tsx` only dispatches window roots and global providers. Feature state stays in feature/store/hook owners.                             | Keep. No root prop-drilling cleanup in this phase.                                                                           |
| Agent runtime and thread state                                         | `src/main/agent`, `src/shared/agent-thread-runtime.ts`, `src/renderer/src/lib/agent-runtime-manager.ts`, `src/renderer/src/lib/agent-runtime-event-projector.ts`, `src/main/threads`              | Runtime writes durable work facts. Renderer projection derives view. React keeps local UI state only.                                       | Keep. Refresh docs to this boundary before any refactor.                                                                     |
| Persistence                                                            | `prisma/schema.prisma`, `src/main/db`, `src/main/checkpointer`, `src/main/storage.ts`                                                                                                             | SQLite/Prisma owns structured app data; checkpointer owns LangGraph checkpoint data; file rules/memory docs are separate.                   | Keep. Dev docs should explain `OPENWORK_HOME` and migration commands.                                                        |
| Launcher search                                                        | `src/main/services/launcher-search`, `src/renderer/src/launcher-shell/hooks/launcher-search-page-store-core.ts`, `src/shared/launcher-search.ts`                                                  | Providers live main-side; renderer owns result presentation and stale request handling.                                                     | Keep. Later cleanup: remove or implement `semantic-history` source only after verifying no planned provider depends on it.   |
| Extension registry and runtime                                         | `src/main/extensions/registry`, `src/main/services/extension-runtime`, `src/extension-runtime`, `src/renderer/src/extension-runtime`, `src/renderer/src/extension-host`, `packages/extension-api` | Registry discovers packages; runtime process/reconciler owns command execution; renderer host renders snapshots.                            | Keep. Dev docs should distinguish built-in, bundled installable, and user installed roots.                                   |
| Built-in extensions                                                    | `src/extensions/todo-list`, `src/extensions/translate`, `extensions/image-generation`                                                                                                             | Built-in packages ship with app; image-generation is an AI capability package outside `src/extensions`.                                     | Keep. Document why `extensions/image-generation` exists outside `src/extensions`, or align later if it causes tooling drift. |
| Installable extensions                                                 | `installable-extensions/apple-reminders`, `github`, `notion`, `figma-files`                                                                                                                       | Installable source packages with manifest/runtime/main/assets. Packaged copies are built into `.ow-build/installed-extensions` / resources. | Keep. Do not move. Fix tooling/docs that still assume all extensions live under `extensions`.                                |
| Diagnostics                                                            | `src/main/diagnostics`, `src/shared/diagnostics.ts`, `src/preload/api/diagnostics.ts`, `src/renderer/src/lib/diagnostics.ts`                                                                      | Main logger owns log files; renderer reports errors through diagnostics IPC; user help explains where logs live.                            | Keep current uncommitted code as product runtime evidence. Add docs after code lands.                                        |

## Dev Tooling Ownership

| Area                         | Current path                                                                                                                      | Recommendation                                                                                                                   |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Package scripts              | `package.json`                                                                                                                    | Keep as the command source of truth. Docs should never claim a script exists without checking this file.                         |
| Extension CLI                | `packages/extension-cli`, `npm run extension:*`                                                                                   | Keep as dev tooling. User docs should not depend on this.                                                                        |
| Migration tooling            | `packages/extension-migration`, `scripts/migrate-extension.mjs`, migration harness tests                                          | Keep but label as migration/dev tooling. Avoid putting migration docs in the current user extension entrypoint.                  |
| Guardrails and doctor        | `.agents/skills/launcher-extension-guardrails/scripts`, `npm run doctor`, `npm run check:guardrails`                              | Keep as dev tooling. Wave 3 tightened extension directory discovery and included `installable-extensions` in guardrail coverage. |
| Packaging scripts            | `scripts/run-electron-builder.mjs`, `scripts/build-installed-extension.mjs`, `scripts/build-native-island.mjs`, `scripts/audit-*` | Keep. Release runbook should map scripts to GitHub Actions and local package commands.                                           |
| Workspace dependency scripts | `scripts/run-with-dotenv.mjs`, `scripts/run-with-env.mjs`, `scripts/run-prisma-openwork-db.mjs`                                   | Keep. Dev docs should explain environment loading and `OPENWORK_HOME` test isolation.                                            |

## Test Ownership

| Test type          | Current path                                                         | Boundary                                                                                                 | Recommendation                                                                   |
| ------------------ | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| BDD user workflows | `tests/bdd/features`, `tests/bdd/steps`, `tests/bdd/support`         | Covers cross-process UI workflows with isolated `OPENWORK_HOME`.                                         | Keep. Add dev doc matrix that maps feature families to BDD files.                |
| Node tests         | `tests/node/*.test.ts`                                               | Covers shared logic, services, runtime, extension packages, projections, provider adapters, diagnostics. | Keep. Add targeted command examples for production release gate.                 |
| Typechecks         | `tsconfig.node.json`, `tsconfig.web.json`, `tests/*/tsconfig.json`   | Main/preload/renderer/test type contracts.                                                               | Keep as mandatory release gate.                                                  |
| Guardrail checks   | `.agents/skills/launcher-extension-guardrails/scripts`               | Architecture/import/package-boundary checks.                                                             | Keep as a release gate; rerun after extension root or launcher boundary changes. |
| UI audit           | `scripts/ui-audit-launcher.mjs`, `docs/launcher-ui-audit-harness.md` | Visual/runtime audit aid for launcher.                                                                   | Keep as optional targeted check after launcher UI changes.                       |

## Docs and Content Ownership

| Content class        | Target path                                                        | Rule                                                                                                  |
| -------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| User help center     | `docs/help`                                                        | Short, current, task-oriented. No migration history, no internal debate.                              |
| Dev docs             | `docs/dev` or curated root docs index                              | Current commands, architecture contracts, extension dev, debugging, packaging, testing.               |
| Production readiness | `docs/production-readiness`                                        | Audit outputs, governance decisions, execution waves. Temporary until release governance is complete. |
| Blog drafts          | `docs/blog-drafts` or `docs/launch` if kept as launch-only content | Product essays and technical articles. Must not be linked as user help.                               |
| Archive/research     | Future archive folder or explicit archive section under `docs/README.md` | Historical docs stay searchable but are not current contract docs.                                    |

## Suggested Cleanup Boundaries

### Keep in place

- `installable-extensions/*`: current production package source roots.
- `src/extensions/*` and `extensions/image-generation`: current bundled first-party extension roots until a specific tooling/import issue justifies consolidation.
- `src/main/services/extension-runtime` and `src/extension-runtime`: main-side manager and runtime implementation have different owners; do not collapse.
- `tests/bdd` and `tests/node`: both are active and complementary.

### Rewrite docs before moving code

- Release/packaging documentation.
- Model provider documentation.
- Extension package contract/dev guide.
- Runtime invariants/thread lifecycle docs.
- Memory user/developer docs.

### Archive before deleting

- Migration proposals and Raycast-heavy research.
- Launch/product essays that are not meant to be help docs.
- Old roadmap documents whose current state has already landed.

### Investigate before changing

- `semantic-history` in `src/shared/launcher-search.ts`: type exists but no provider is registered in `src/main/services/launcher-search/index.ts`.
- Guardrail scope after future extension-root changes: keep `src/extensions`, `extensions`, and `installable-extensions` covered together.
- `docs/README.md` current index: mixing current contracts and research makes it hard to know what production release relies on.

## Non-Goals For The First Cleanup Waves

- No large directory migration.
- No generic docs framework.
- No new abstraction around extension roots unless a concrete doctor/guardrail failure proves it is needed.
- No broad fallback layer in renderer or runtime to tolerate stale docs/contracts.
- No deletion of historical docs until replacements exist and the docs index no longer points users at them as current truth.
