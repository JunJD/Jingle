# Contributing to Jingle

Thank you for helping make Jingle better. This project is a desktop launcher,
extension platform, and agent runtime, so good contributions start by naming the
owner of the change before editing files.

## Development Setup

### Prerequisites

- Node.js 18+
- pnpm 10+
- Git

### Getting Started

```bash
git clone https://github.com/JunJD/Jingle.git
cd Jingle
make setup
make dev
```

## Useful Commands

```bash
make help
make dev
make check
make test
make build
```

The Makefile is the public development entrypoint. `package.json` scripts are
implementation details for CI and maintainers.

Run the smallest relevant check first. For dependency or packaging changes, run
`make check` and the relevant package audit before opening a PR. Frontend
dependency changes should include the frontend package audit named by the PR
template.

## Project Boundaries

Jingle has several important ownership layers:

- `src/main`: Electron main process, durable services, IPC owners, database and
  filesystem boundaries
- `src/preload`: typed bridge between main and renderer
- `src/renderer`: React UI, launcher shell, settings, chat surfaces, and local UI
  interaction state
- `src/shared`: contracts shared across process boundaries
- `packages/langchain-agent-harness`: agent runtime, tool execution, approvals,
  checkpoints, and stream decoding
- `packages/extension-*`: public extension SDK, utilities, and CLI
- `installable-extensions`: bundled extension packages that should import only
  public `@jingle/*` APIs

Before changing a workflow, identify which layer owns the state, which layer
only projects it for display, and how failures should become visible.

## Naming

The canonical product and internal agent name is `jingle`. Chinese UI may display
the name as `金果`. Stable code identifiers, package scopes, schemas, events,
tools, and persisted fields should use `jingle`. Local storage should use
`JINGLE_HOME`, `~/.jingle`, and `jingle.sqlite`.

## Code Style

- Keep TypeScript strict and explicit.
- Prefer existing local patterns over new abstractions.
- Avoid defensive fallback unless the input is actually untrusted or the failure
  mode is known.
- Keep parser, codec, schema, runtime, projection, and React component
  responsibilities separate.
- Do not push core runtime state down into UI components.
- Keep transient UI state, such as hover, copied, expanded, and pressed, inside
  the component that owns the interaction.

## Testing

Use the test level that matches the risk:

- typecheck for contract and package changes
- node tests for runtime, parser, persistence, and extension SDK behavior
- BDD tests for user-visible desktop workflows and cross-process behavior
- visual or Playwright checks for launcher and window UX changes

BDD scenarios must isolate local state with `JINGLE_HOME`.

## Pull Request Process

1. Create a focused branch from the current public base branch.
2. Keep the PR scoped to one owner boundary.
3. Explain the state owner, dependency direction, and failure semantics when the
   change crosses main/preload/renderer/runtime boundaries.
4. Include the checks you ran and any checks you intentionally skipped.
5. Add screenshots for UI changes.

## Commit Messages

Use short, direct commit subjects. Conventional prefixes are welcome:

- `feat:`
- `fix:`
- `docs:`
- `refactor:`
- `test:`
- `chore:`

## Questions

Open a GitHub issue or discussion with a small reproduction, the owning layer you
think is involved, and the checks you already ran.

For support expectations, see [SUPPORT.md](SUPPORT.md). For community conduct,
see [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
