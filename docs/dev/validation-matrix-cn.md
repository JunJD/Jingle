# 验证矩阵

[English](./validation-matrix.md)

这个矩阵把生产发布检查映射到当前 scripts 和 test owners。`package.json` 是命令事实源。

## 命令参考

| Command                               | Owner                                                                                            | What it checks                                                                                      | Failure semantics                                           |
| ------------------------------------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `pnpm run doctor`                     | `.agents/skills/launcher-extension-guardrails/scripts/doctor-architecture.mjs`                   | Advisory architecture diagnostics：route language 和 secrets boundary                               | 打印可行动诊断；不应因为 stale extension directories 崩掉。 |
| `pnpm run check:guardrails`           | `.agents/skills/launcher-extension-guardrails/scripts/check-guardrails.mjs`                      | Launcher 和 native extensions 的 blocking architecture/import/package-boundary checks               | 遇到 boundary violations 直接失败。                         |
| `pnpm run check:extensions`           | `scripts/check-native-extensions.mjs`, `scripts/native-extension-package-boundaries.mjs`         | Native extension registry 和 package boundary validation                                            | 遇到 package/registry errors 失败。                         |
| `pnpm run typecheck`                  | `tsconfig.node.json`, `tsconfig.web.json`, `tests/node/tsconfig.json`, `tests/bdd/tsconfig.json` | Main、renderer、node tests 和 BDD TypeScript contracts                                              | 遇到 type contract drift 失败。                             |
| `pnpm run test:node`                  | `tests/node/*.test.ts`                                                                           | Runtime、services、projections、extensions、models、diagnostics 的 node-side unit/integration tests | 在窄模块或 service boundary 失败。                          |
| `pnpm run test:node:target -- <file>` | `tests/node`                                                                                     | Targeted node test execution                                                                        | 小型代码或 tooling 改动先用 targeted tests，再扩大范围。    |
| `pnpm run test:bdd:smoke`             | `tests/bdd/features` with `@smoke`                                                               | Production build 后的 Electron smoke workflow                                                       | 先 build，启动 Electron，使用隔离 `OPENWORK_HOME`。         |
| `pnpm run test:bdd`                   | `tests/bdd`                                                                                      | Full Cucumber/Playwright Electron workflow suite                                                    | 先 build，启动 Electron，使用隔离 `OPENWORK_HOME`。         |
| `pnpm run build`                      | `scripts/build-with-react-compiler-guard.mjs`                                                    | Prisma generate、完整 typecheck、Electron build、React compiler skip guard                          | typecheck/build 失败或 React compiler 跳过优化时失败。      |
| `pnpm run dist:mac`                   | `scripts/run-electron-builder.mjs`, `electron-builder.yml`                                       | macOS DMG packaging                                                                                 | build 或 electron-builder packaging errors 时失败。         |
| `pnpm run dist:mac:dir`               | `scripts/run-electron-builder.mjs`, `electron-builder.yml`                                       | 不自动发现 codesign certificate 的 macOS unpacked directory packaging                               | 适合本地 packaging smoke。                                  |
| `pnpm run dist:win`                   | `scripts/build-win-icon.mjs`, `scripts/run-electron-builder.mjs`                                 | Windows installer packaging                                                                         | 生产发布应在 Windows CI 上验证。                            |
| `pnpm run dist:linux`                 | `scripts/run-electron-builder.mjs`                                                               | Linux AppImage packaging                                                                            | 生产发布应在 Linux CI 上验证。                              |
| `pnpm run audit:package-size`         | `scripts/audit-package-size.mjs`                                                                 | Package-size review                                                                                 | Packaging/runtime dependency changes 后的 targeted check。  |
| `pnpm run audit:packaged-runtime`     | `scripts/audit-packaged-runtime.mjs`                                                             | Packaged runtime dependency review                                                                  | Packaging/runtime dependency changes 后的 targeted check。  |
| `pnpm run ui-audit:launcher`          | `scripts/ui-audit-launcher.mjs`                                                                  | Launcher visual/runtime audit                                                                       | Launcher UI work 后的 targeted check。                      |

## BDD Feature Map

BDD tests 用于 user-visible workflows 和 cross-process behavior。它们位于 `tests/bdd/features`，step implementations 位于 `tests/bdd/steps`。

| Product surface                                                  | Feature files                                                                                                                                                    |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| App launch、launcher keyboard flow、settings entry、main history | `app-launch.feature`, `launcher-history.feature`                                                                                                                 |
| Agent runs、approvals、artifacts、workspace context              | `agent.feature`, `tool-approval.feature`, `artifacts.feature`, `artifact-tabs.feature`, `workspace.feature`                                                      |
| Command execution safety                                         | `execute-command-classifier.feature`, `execute-command-classifier-platform.feature`, `execute-command-guardrail.feature`, `subagent-read-only-guardrail.feature` |
| Extensions and native surfaces                                   | `native-extensions.feature`, `external-extension-contract.feature`, `native-menu-bar.feature`, `todo-list.feature`                                               |
| Settings and model providers                                     | `settings.feature`, `model-provider.feature`, `shortcuts.feature`                                                                                                |
| Threads、history、links、local start                             | `threads.feature`, `launcher-side-effects.feature`, `external-links.feature`, `local-start.feature`                                                              |
| Recording and filesystem behavior                                | `recording-fs.feature`                                                                                                                                           |

BDD isolation 是测试合同的一部分：`tests/bdd/support/world.ts` 会创建临时 `OPENWORK_HOME`、执行 Prisma migrations、启动 Electron，并在每个 scenario 后清理。

## Node Test Map

Node tests 保护更窄的 contracts；这些场景用完整 Electron scenario 会太慢或太宽。

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

小改动先用 targeted node tests，再在 release 或 shared-boundary changes 时扩大到 `pnpm run test:node`。

## Release Gate Recommendation

生产桌面发布前，运行或确认：

```bash
pnpm run doctor
pnpm run check:guardrails
pnpm run check:extensions
pnpm run typecheck
pnpm run test:node
pnpm run test:bdd:smoke
```

如果涉及 broad runtime、launcher、extension 或 packaging changes，再加：

```bash
pnpm run test:bdd
pnpm run build
```

Release artifact validation 使用 [release-runbook-cn.md](./release-runbook-cn.md) 中对应命令。
