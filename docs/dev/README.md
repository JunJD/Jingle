# Openwork Developer Guide

[中文开发者指南](./README-cn.md)

This folder is the current developer entrypoint for production release work. It
maps repo commands to the product surfaces they protect, and it keeps dev
tooling separate from user help and launch content.

## Current Owners

| Area                           | Owner paths                                                                                                                   | Primary docs                                                                                                        |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| App lifecycle and windows      | `src/main/index.ts`, `src/main/windows`, `src/main/composition-root.ts`, `src/renderer/src/main.tsx`                          | [Electron debugging](../openwork-electron-debugging.md)                                                             |
| Agent runtime and persistence  | `src/main/agent`, `src/main/threads`, `src/shared/agent-thread-runtime.ts`, `prisma/schema.prisma`                            | [Engineering boundaries](../engineering-boundaries.md), [Runtime invariants](../runtime-invariants.md)              |
| Launcher and renderer surfaces | `src/renderer/src/launcher-shell`, `src/renderer/src/ai-core`, `src/renderer/src/extension-host`, `src/renderer/src/settings` | [Engineering boundaries](../engineering-boundaries.md)                                                              |
| Native extension packages      | `src/extensions`, `extensions/image-generation`, `installable-extensions`, `packages/extension-api`, `packages/extension-cli` | [Extension development](./extension-development.md), [Extension package contract](../extension-package-contract.md) |
| Tests and quality gates        | `tests/bdd`, `tests/node`, `.agents/skills/launcher-extension-guardrails/scripts`, `scripts`                                  | [Validation matrix](./validation-matrix.md)                                                                         |
| Release and packaging          | `package.json`, `.github/workflows`, `electron-builder.yml`, `scripts/run-electron-builder.mjs`                               | [Release runbook](./release-runbook.md)                                                                             |

## Local Development

Install dependencies with pnpm:

```bash
pnpm install
```

Start the development app:

```bash
pnpm run dev
```

`pnpm run dev` first builds bundled installable extensions through
`scripts/build-installed-extension.mjs`, then starts Electron through
`electron-vite dev`.

Openwork stores local app data under `~/.openwork` by default. For isolated
debugging or test reproduction, set `OPENWORK_HOME` to a temporary directory:

```bash
OPENWORK_HOME=/tmp/openwork-dev pnpm run dev
```

## Production Release Checks

Run the quality gates that match the changed surface:

| Change type                                             | Minimum checks                                                                                        |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Docs only                                               | Prettier on touched docs and local link check                                                         |
| Main/preload/renderer TypeScript                        | `pnpm run typecheck`, targeted `pnpm run test:node:target -- <tests>`                                 |
| Agent runtime, persistence, approvals, or IPC           | `pnpm run typecheck`, `pnpm run test:node`, targeted BDD                                              |
| Launcher, settings, windows, workspace, or extension UX | `pnpm run test:bdd:smoke`, targeted BDD feature                                                       |
| Native extension package or extension runtime           | `pnpm run doctor`, `pnpm run check:guardrails`, `pnpm run check:extensions`, targeted extension tests |
| Packaging or release flow                               | `pnpm run build`, platform packaging command, release workflow review                                 |

For the detailed command map, use [validation-matrix.md](./validation-matrix.md).

## Debugging

- Electron renderer and CDP debugging: [openwork-electron-debugging.md](../openwork-electron-debugging.md).
- User-facing log location and support redaction: [help/logs-and-diagnostics/find-logs.md](../help/logs-and-diagnostics/find-logs.md).
- Local data root: `src/main/storage.ts` resolves `OPENWORK_HOME` or `~/.openwork`.
- BDD scenarios isolate user data with temporary `OPENWORK_HOME` directories in `tests/bdd/support/world.ts`.

## Documentation Boundaries

- Put user-facing instructions under `docs/help`.
- Put current developer runbooks under `docs/dev`.
- Put production audit and execution planning under `docs/production-readiness`.
- Keep launch essays and blog drafts out of help/dev docs.
- Historical migration or research docs must stay marked as archive or refresh in [docs/README.md](../README.md).
