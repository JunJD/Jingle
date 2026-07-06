# Jingle Docs

This directory keeps current reader-facing guides and contributor contracts.
One-off investigation notes, launch checklists, mockups, and scratchpads stay
out of the public docs tree.

## Setup

Start with the repository README:

- [English README](../README.md)
- [简体中文 README](../README.zh-CN.md)

The public command entrypoint is the root [Makefile](../Makefile).

## Develop

Use these documents when changing code:

- [engineering-boundaries.md](./engineering-boundaries.md): owner boundaries
  across main, preload, renderer, runtime, and extension surfaces.
- [runtime-invariants.md](./runtime-invariants.md): durable runtime,
  checkpoint, approval, projection, and database invariants.
- [extension-package-contract.md](./extension-package-contract.md): package
  shape and runtime contract for installable extensions.
- [installable-extension-dev-guide-cn.md](./installable-extension-dev-guide-cn.md):
  Chinese guide for building and testing an installable extension.

## Use

For local use from source:

```bash
make setup
make use
```

For daily development:

```bash
make dev
make check
make test
```

For product direction:

- [English roadmap](../roadmap.md)
- [简体中文路线图](../roadmap.zh-CN.md)

For releases:

- [release-channels.md](./release-channels.md)
- [release-channels.zh-CN.md](./release-channels.zh-CN.md)
