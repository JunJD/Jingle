# Extension Development

[English](./extension-development.md)

Openwork 当前有三个 first-party extension source roots。除非出现具体 tooling 问题并证明值得移动代码，否则把它们当作独立 owner roots。

| Root                     | Role                                            | Examples                                                               |
| ------------------------ | ----------------------------------------------- | ---------------------------------------------------------------------- |
| `src/extensions`         | Built-in extension packages and host registries | `todo-list`, `translate`, `index.ts`, `main.ts`, `runtime-packages.ts` |
| `extensions`             | Bundled package root outside `src`              | `image-generation`                                                     |
| `installable-extensions` | Bundled installable package source roots        | `apple-reminders`, `github`, `notion`, `figma-files`                   |

## Package Contract

Native extension package 应暴露：

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

简明合同见 [extension-package-contract.md](../extension-package-contract.md)。本页作为命令 runbook；package semantics 以 contract doc 为准。

## Build Commands

构建所有 bundled installable extensions：

```bash
pnpm run build:installed-extensions
```

构建指定 installable package：

```bash
pnpm run extension -- build installable-extensions/github
pnpm run extension -- build github
```

运行 extension dev watch：

```bash
pnpm run extension -- dev installable-extensions/github
```

Extension CLI 默认把 built packages 写入 `.ow-build/installed-extensions`。Dev mode 下，当 `ELECTRON_RENDERER_URL` 被设置时，Openwork 会在 process startup 发现这个 root。Rebuild 后请重启 dev app；extension hot reload 尚未实现。

## Validation

Extension package changes 运行：

```bash
pnpm run doctor
pnpm run check:guardrails
pnpm run check:extensions
pnpm run typecheck
```

根据触及的 extension 添加 targeted node tests：

```bash
pnpm run test:node:target -- tests/node/github-notion-ai-tools.test.ts
pnpm run test:node:target -- tests/node/apple-reminders-source-tools.test.ts
pnpm run test:node:target -- tests/node/figma-files-cache.test.ts
pnpm run test:node:target -- tests/node/translate-runtime.test.ts
```

如果改动影响可见 launcher 或 settings flow，添加 targeted BDD：

```bash
pnpm run test:bdd:smoke
```

## Boundary Rules

- `manifest.ts` 声明 user-visible commands、preferences、connections、runtime capabilities、AI capability metadata 和 package assets。
- `runtime.ts` 把 command names 映射到 renderer components 或 no-view runners。
- `runtime-metadata.ts` 包含 JSON-safe metadata，供 launcher/search projection 使用，不 import UI 或 main-process code。
- `main.ts` 拥有 main-process extension services、AI tools 和 RPC surfaces。
- Runtime code 必须使用 `@openwork/extension-api`，不要 import private `src/main`、`src/preload` 或 `src/renderer` implementation。
- Installable package runtime metadata 不得 import command components、runtime state、secrets 或 main-process helpers。
- Secrets 和 OAuth tokens 由 host connection 与 preference services 解析；extension code 不应绕过这些 owners。

## Guardrail Coverage

Launcher extension guardrails 当前覆盖 `src/extensions`、`extensions` 和 `installable-extensions`。只包含 dependency artifacts 的空目录会被 extension discovery 忽略；带有 source signals 的目录会被检查，例如 `manifest.ts`、`main.ts`、`runtime.ts`、`runtime-metadata.ts`、`src/`、`main/` 或 `package.json`。
