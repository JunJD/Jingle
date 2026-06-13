# Extension Development

[中文](./extension-development-cn.md)

Openwork has three current first-party extension source roots. Treat them as
separate owner roots until a concrete tooling problem justifies moving code.

| Root                     | Role                                            | Examples                                                               |
| ------------------------ | ----------------------------------------------- | ---------------------------------------------------------------------- |
| `src/extensions`         | Built-in extension packages and host registries | `todo-list`, `translate`, `index.ts`, `main.ts`, `runtime-packages.ts` |
| `extensions`             | Bundled package root outside `src`              | `image-generation`                                                     |
| `installable-extensions` | Bundled installable package source roots        | `apple-reminders`, `github`, `notion`, `figma-files`                   |

## Package Contract

A native extension package should expose:

```text
manifest.ts
runtime.ts
runtime-metadata.ts
main.ts
src/
main/
assets/
package.json
```

The concise contract lives in
[extension-package-contract.md](../extension-package-contract.md). Use this
page as the command runbook; use the contract doc for package semantics.

## Build Commands

Build all bundled installable extensions:

```bash
pnpm run build:installed-extensions
```

Build a specific installable package:

```bash
pnpm run extension -- build installable-extensions/github
pnpm run extension -- build github
```

Run extension dev watch:

```bash
pnpm run extension -- dev installable-extensions/github
```

The extension CLI writes built packages to `.ow-build/installed-extensions` by
default. In dev mode, Openwork discovers that root at process startup when
`ELECTRON_RENDERER_URL` is set. Restart the dev app after rebuilds; extension
hot reload is not implemented.

## Validation

For extension package changes, run:

```bash
pnpm run doctor
pnpm run check:guardrails
pnpm run check:extensions
pnpm run typecheck
```

Add targeted node tests for the extension touched:

```bash
pnpm run test:node:target -- tests/node/github-notion-ai-tools.test.ts
pnpm run test:node:target -- tests/node/apple-reminders-source-tools.test.ts
pnpm run test:node:target -- tests/node/figma-files-cache.test.ts
pnpm run test:node:target -- tests/node/translate-runtime.test.ts
```

Add targeted BDD when the change affects a visible launcher or settings flow:

```bash
pnpm run test:bdd:smoke
```

## Boundary Rules

- `manifest.ts` declares user-visible commands, preferences, connections,
  runtime capabilities, AI capability metadata, and package assets.
- `runtime.ts` maps command names to renderer components or no-view runners.
- `runtime-metadata.ts` contains JSON-safe metadata for launcher/search
  projection.
- `main.ts` owns main-process extension services, AI tools, and RPC surfaces.
- Runtime code must use `@openwork/extension-api` instead of importing private
  `src/main`, `src/preload`, or `src/renderer` implementation.
- Installable package runtime metadata must not import command components,
  runtime state, secrets, or main-process helpers.
- Secrets and OAuth tokens are resolved by host connection and preference
  services; extension code should not bypass those owners.

## Guardrail Coverage

The launcher extension guardrails currently cover `src/extensions`,
`extensions`, and `installable-extensions`. Empty directories that only contain
dependency artifacts are ignored by extension discovery; directories with source
signals such as `manifest.ts`, `main.ts`, `runtime.ts`, `runtime-metadata.ts`,
`src/`, `main/`, or `package.json` are checked.
