# Openwork 开发者指南

[English developer guide](./README.md)

这个目录是当前生产发布工作的开发者入口。它把 repo commands 映射到它们保护的 product surfaces，并把 dev tooling 与用户帮助、发布内容分开。

## 当前 Owners

| Area                           | Owner paths                                                                                                                   | Primary docs                                                                                                           |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| App lifecycle and windows      | `src/main/index.ts`, `src/main/windows`, `src/main/composition-root.ts`, `src/renderer/src/main.tsx`                          | [Electron debugging](../openwork-electron-debugging.md)                                                                |
| Agent runtime and persistence  | `src/main/agent`, `src/main/threads`, `src/shared/agent-thread-runtime.ts`, `prisma/schema.prisma`                            | [Engineering boundaries](../engineering-boundaries.md), [Runtime invariants](../runtime-invariants.md)                 |
| Launcher and renderer surfaces | `src/renderer/src/launcher-shell`, `src/renderer/src/ai-core`, `src/renderer/src/extension-host`, `src/renderer/src/settings` | [Engineering boundaries](../engineering-boundaries.md)                                                                 |
| Native extension packages      | `src/extensions`, `extensions/image-generation`, `installable-extensions`, `packages/extension-api`, `packages/extension-cli` | [Extension development](./extension-development-cn.md), [Extension package contract](../extension-package-contract.md) |
| Tests and quality gates        | `tests/bdd`, `tests/node`, `.agents/skills/launcher-extension-guardrails/scripts`, `scripts`                                  | [Validation matrix](./validation-matrix-cn.md)                                                                         |
| Release and packaging          | `package.json`, `.github/workflows`, `electron-builder.yml`, `scripts/run-electron-builder.mjs`                               | [Release runbook](./release-runbook-cn.md)                                                                             |

## 本地开发

使用 pnpm 安装依赖：

```bash
pnpm install
```

启动开发版应用：

```bash
pnpm run dev
```

`pnpm run dev` 会先通过 `scripts/build-installed-extension.mjs` 构建 bundled installable extensions，再通过 `electron-vite dev` 启动 Electron。

Openwork 默认把本地应用数据存在 `~/.openwork`。如果要隔离调试或复现测试，设置 `OPENWORK_HOME` 到临时目录：

```bash
OPENWORK_HOME=/tmp/openwork-dev pnpm run dev
```

## 生产发布检查

根据改动 surface 选择质量门禁：

| Change type                                             | Minimum checks                                                                                        |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Docs only                                               | 对 touched docs 跑 Prettier，并做本地链接检查                                                         |
| Main/preload/renderer TypeScript                        | `pnpm run typecheck`，targeted `pnpm run test:node:target -- <tests>`                                 |
| Agent runtime, persistence, approvals, or IPC           | `pnpm run typecheck`，`pnpm run test:node`，targeted BDD                                              |
| Launcher, settings, windows, workspace, or extension UX | `pnpm run test:bdd:smoke`，targeted BDD feature                                                       |
| Native extension package or extension runtime           | `pnpm run doctor`，`pnpm run check:guardrails`，`pnpm run check:extensions`，targeted extension tests |
| Packaging or release flow                               | `pnpm run build`，platform packaging command，release workflow review                                 |

详细命令矩阵见 [validation-matrix-cn.md](./validation-matrix-cn.md)。

## Debugging

- Electron renderer 和 CDP debugging：[openwork-electron-debugging.md](../openwork-electron-debugging.md)。
- 用户可见日志位置和 support redaction：[help/logs-and-diagnostics/find-logs-cn.md](../help/logs-and-diagnostics/find-logs-cn.md)。
- 本地数据根：`src/main/storage.ts` 会解析 `OPENWORK_HOME` 或 `~/.openwork`。
- BDD scenarios 在 `tests/bdd/support/world.ts` 中用临时 `OPENWORK_HOME` 隔离用户数据。

## 文档边界

- 用户说明放在 `docs/help`。
- 当前开发 runbooks 放在 `docs/dev`。
- 生产审计和执行计划放在 `docs/production-readiness`。
- 发布文章和 blog drafts 不要混进 help/dev docs。
- 历史 migration 或 research docs 必须在 [docs/README-cn.md](../README-cn.md) 中标为 archive 或 refresh。
