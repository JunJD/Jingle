# Validation Matrix

[中文](./validation-matrix-cn.md)

This matrix maps production-release checks to current scripts and test owners.
`package.json` is the command source of truth.

## Command Reference

| Command                               | Owner                                                                                            | What it checks                                                                                           | Failure semantics                                                                  |
| ------------------------------------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `pnpm run doctor`                     | `.agents/skills/launcher-extension-guardrails/scripts/doctor-architecture.mjs`                   | Advisory architecture diagnostics: route language and secrets boundary                                   | Prints actionable diagnostics. It should not crash on stale extension directories. |
| `pnpm run check:guardrails`           | `.agents/skills/launcher-extension-guardrails/scripts/check-guardrails.mjs`                      | Blocking architecture/import/package-boundary checks for launcher and native extensions                  | Fails the command on boundary violations.                                          |
| `pnpm run check:extensions`           | `scripts/check-native-extensions.mjs`, `scripts/native-extension-package-boundaries.mjs`         | Native extension registry and package boundary validation                                                | Fails with package/registry errors.                                                |
| `pnpm run typecheck`                  | `tsconfig.node.json`, `tsconfig.web.json`, `tests/node/tsconfig.json`, `tests/bdd/tsconfig.json` | Main, renderer, node tests, and BDD TypeScript contracts                                                 | Fails on type contract drift.                                                      |
| `pnpm run test:node`                  | `tests/node/*.test.ts`                                                                           | Node-side unit and integration tests for runtime, services, projections, extensions, models, diagnostics | Fails at the narrow module or service boundary.                                    |
| `pnpm run test:node:target -- <file>` | `tests/node`                                                                                     | Targeted node test execution                                                                             | Use for small code/tooling changes before broad suites.                            |
| `pnpm run test:bdd:smoke`             | `tests/bdd/features` with `@smoke`                                                               | Electron smoke workflow after a production build                                                         | Builds first, launches Electron, uses isolated `OPENWORK_HOME`.                    |
| `pnpm run test:bdd`                   | `tests/bdd`                                                                                      | Full Cucumber/Playwright Electron workflow suite                                                         | Builds first, launches Electron, uses isolated `OPENWORK_HOME`.                    |
| `pnpm run build`                      | `scripts/build-with-react-compiler-guard.mjs`                                                    | Prisma generate, full typecheck, Electron build, React compiler skip guard                               | Fails if typecheck/build fails or React compiler skips optimization.               |
| `pnpm run dist:mac`                   | `scripts/run-electron-builder.mjs`, `electron-builder.yml`                                       | macOS DMG packaging                                                                                      | Fails on build or electron-builder packaging errors.                               |
| `pnpm run dist:mac:dir`               | `scripts/run-electron-builder.mjs`, `electron-builder.yml`                                       | macOS unpacked directory packaging without code-sign discovery                                           | Useful for local packaging smoke.                                                  |
| `pnpm run dist:win`                   | `scripts/build-win-icon.mjs`, `scripts/run-electron-builder.mjs`                                 | Windows installer packaging                                                                              | Should be verified on Windows CI for production release.                           |
| `pnpm run dist:linux`                 | `scripts/run-electron-builder.mjs`                                                               | Linux AppImage packaging                                                                                 | Should be verified on Linux CI for production release.                             |
| `pnpm run audit:package-size`         | `scripts/audit-package-size.mjs`                                                                 | Package-size review                                                                                      | Targeted check after packaging/runtime dependency changes.                         |
| `pnpm run audit:packaged-runtime`     | `scripts/audit-packaged-runtime.mjs`                                                             | Packaged runtime dependency review                                                                       | Targeted check after packaging/runtime dependency changes.                         |
| `pnpm run ui-audit:launcher`          | `scripts/ui-audit-launcher.mjs`                                                                  | Launcher visual/runtime audit                                                                            | Targeted check after launcher UI work.                                             |

## BDD Feature Map

BDD tests are for user-visible workflows and cross-process behavior. They live
under `tests/bdd/features` with step implementations in `tests/bdd/steps`.

| Product surface                                                  | Feature files                                                                                                                                                    |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| App launch, launcher keyboard flow, settings entry, main history | `app-launch.feature`, `launcher-history.feature`                                                                                                                 |
| Agent runs, approvals, artifacts, workspace context              | `agent.feature`, `tool-approval.feature`, `artifacts.feature`, `artifact-tabs.feature`, `workspace.feature`                                                      |
| Command execution safety                                         | `execute-command-classifier.feature`, `execute-command-classifier-platform.feature`, `execute-command-guardrail.feature`, `subagent-read-only-guardrail.feature` |
| Extensions and native surfaces                                   | `native-extensions.feature`, `external-extension-contract.feature`, `native-menu-bar.feature`, `todo-list.feature`                                               |
| Settings and model providers                                     | `settings.feature`, `model-provider.feature`, `shortcuts.feature`                                                                                                |
| Threads, history, links, local start                             | `threads.feature`, `launcher-side-effects.feature`, `external-links.feature`, `local-start.feature`                                                              |
| Recording and filesystem behavior                                | `recording-fs.feature`                                                                                                                                           |

BDD isolation is part of the test contract: `tests/bdd/support/world.ts` creates
a temporary `OPENWORK_HOME`, runs Prisma migrations, launches Electron, and
cleans up after each scenario.

## Node Test Map

Node tests are for narrower contracts where a full Electron scenario would be
too slow or too broad.

| Area                               | Representative tests                                                                                                                                                           |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Agent runtime and persistence      | `agent-*.test.ts`, `agent-thread-*.test.ts`, `thread-runtime-batch.test.ts`, `thread-store-core.test.ts`                                                                       |
| Approvals and command safety       | `tool-approval*.test.ts`, `execute-command-*.test.ts`, `mutation-predictor.test.ts`, `file-mutation-review.test.ts`                                                            |
| Renderer projection and chat state | `message-*.test.ts`, `action-message-view.test.ts`, `hitl-*.test.ts`, `artifact-*.test.ts`                                                                                     |
| Launcher and workspace search      | `launcher-*.test.ts`, `workspace-file-*.test.ts`, `search-text.test.ts`                                                                                                        |
| Models and credentials             | `model-provider-*.test.ts`, `preferences-workspace.test.ts`                                                                                                                    |
| Native extension runtime           | `extension-*.test.ts`, `native-extension-*.test.ts`, `github-*.test.ts`, `notion-*.test.ts`, `apple-reminders-*.test.ts`, `figma-files-*.test.ts`, `translate-runtime.test.ts` |
| IPC and protocol contracts         | `ipc-*.test.ts`, `protocol-client-registration.test.ts`, `open-targets-service.test.ts`                                                                                        |
| Diagnostics and observability      | `diagnostics.test.ts`, `observability.test.ts`                                                                                                                                 |

Use targeted node tests for small code changes, then broaden to
`pnpm run test:node` for release or shared-boundary changes.

## Release Gate Recommendation

Before a production desktop release, run or verify:

```bash
pnpm run doctor
pnpm run check:guardrails
pnpm run check:extensions
pnpm run typecheck
pnpm run test:node
pnpm run test:bdd:smoke
```

For broad runtime, launcher, extension, or packaging changes, add:

```bash
pnpm run test:bdd
pnpm run build
```

For release artifact validation, use the relevant command from
[release-runbook.md](./release-runbook.md).
