# Jingle

[English](README.md) | [简体中文](README.zh-CN.md)

[![License: MIT][license-badge]][license-url]

[license-badge]: https://img.shields.io/badge/License-MIT-yellow.svg
[license-url]: https://opensource.org/licenses/MIT

Jingle is a desktop command launcher and agent workbench.

Official site: [jingle.cool](https://jingle.cool)

It takes the keyboard-first speed of Raycast as the baseline, then adds the
parts an agent needs when work moves beyond a short chat: approvals, tool
execution, checkpoints, thread history, local memory, and extension tools that
can be inspected by the user.

> [!CAUTION]
> Jingle can give AI agents access to files, local tools, and shell commands.
> Review tool calls before approving them, and only run Jingle in workspaces you
> trust.

## Quick Start

### 1. Setup

```bash
git clone https://github.com/JunJD/Jingle.git
cd Jingle
make setup
```

Requires Node.js 18+ and pnpm 10+.

`make setup` installs dependencies, generates the Prisma client, and applies the
local Jingle database migrations.

For optional local environment variables, copy `.env.example` to `.env` and
fill only the values you need. Do not commit `.env` or real secrets.

### 2. Develop

```bash
make dev
```

Use the Makefile as the public development entrypoint:

- `make help` lists the stable public commands
- `make check` runs lint, typecheck, and architecture guardrails
- `make test` runs node tests and the BDD smoke suite
- `make build` creates a production-like local build

BDD tests build the app, launch the packaged Electron entrypoint, create an
isolated `JINGLE_HOME` directory for each scenario, and run Prisma migrations
before the app starts.

### 3. Use

```bash
make use
```

`make use` builds Jingle and opens a local preview app. After the first build,
`make start` launches the latest local preview again.

Jingle keeps local state in `JINGLE_HOME` when it is set, otherwise under
`~/.jingle`.

## What Jingle Is

Jingle has three jobs:

- launch apps, commands, extensions, and AI workflows quickly
- run agent work as durable threads with checkpoints and visible approvals
- let extensions expose both UI commands and agent-callable tools

Raycast is the main UX reference for launcher speed, extension ergonomics, AI
commands, agents, skills, and MCP-style integrations. Jingle aims to match that
everyday desktop feel while putting more weight on agent execution: what the
agent saw, what it changed, which tools it used, and where the user stayed in
control.

Useful references:

- [Raycast AI](https://manual.raycast.com/ai)
- [Raycast AI Commands](https://manual.raycast.com/ai/ai-commands)
- [Raycast AI Extensions](https://manual.raycast.com/ai/ai-extensions)
- [Raycast Agents](https://manual.raycast.com/ai/agents)
- [Raycast Skills](https://manual.raycast.com/ai/skills)
- [Raycast MCP](https://manual.raycast.com/model-context-protocol)
- [Raycast extension docs](https://developers.raycast.com/)

Jingle is an open-source project in active development. APIs, extension
contracts, and local data schemas may change before a stable release.

## Extension Development

Jingle extensions use the `@jingle/*` workspace packages:

- `@jingle/extension-api`
- `@jingle/extension-utils`
- `@jingle/extension-cli`

```bash
make extensions
make extension-dev EXTENSION=installable-extensions/coffee
```

Extension package contracts are documented in
[docs/extension-package-contract.md](docs/extension-package-contract.md).

## Roadmap

See [roadmap.md](roadmap.md) for the product and project roadmap. A
Simplified Chinese version is available at
[roadmap.zh-CN.md](roadmap.zh-CN.md).

## Contributing

Contributions are welcome. Start with [CONTRIBUTING.md](CONTRIBUTING.md), keep
changes scoped to a clear owner, and describe runtime or renderer boundary
changes in the PR.

Report bugs via [GitHub Issues](https://github.com/JunJD/Jingle/issues). For
project help, see [SUPPORT.md](SUPPORT.md). For security reports, see
[SECURITY.md](SECURITY.md). For community expectations, see
[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## License

MIT. See [LICENSE](LICENSE).
