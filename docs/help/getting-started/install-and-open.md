# Install And Open

[中文](./install-and-open-cn.md)

Openwork/Jingle is a desktop agent workspace. The app opens to the launcher, which
is where you search, start AI work, open commands, and return to previous threads.

## Install

For the npm package:

```bash
npx openwork
```

Or install it globally:

```bash
npm install -g openwork
openwork
```

Requires Node.js 18+.

For desktop release builds, use the assets attached to the GitHub Release for
your platform. macOS preview builds may be unsigned or not notarized; use
[the macOS preview install guide](../../macos-dev-preview-install.md) when testing
those builds.

## Open The App

When the app starts, the launcher appears first. From the launcher you can:

- type a request and start an AI task,
- search apps, files, browser history, quicklinks, extension commands, and threads,
- open Settings,
- open the history window to return to previous work.

## First Setup

Before running an agent task, open Settings -> Models and configure at least one
model provider. The app can use configured cloud providers, local model
registries, or custom OpenAI-compatible endpoints.

Then choose a trusted workspace before asking the agent to inspect or modify
files. The workspace is the local project boundary for the task.

## From Source

For local development:

```bash
pnpm install
pnpm run dev
```

The dev script builds bundled installable extensions before starting Electron.
