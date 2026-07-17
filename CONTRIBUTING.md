# Contributing to Jingle

Thank you for helping make Jingle better. This project is a desktop launcher,
extension platform, and agent runtime, so good contributions start by naming the
owner of the change before editing files.

## Development Setup

### Prerequisites

- Node.js 20.19+ or 22.12+
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

Jingle uses [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/)
with a required owner scope:

```text
<type>(<scope>): <direct description>
```

Descriptions may be Chinese or English. Prefer a short imperative phrase, keep
the complete header within 72 characters, and do not end it with a period.

Types have the following meanings:

- `feat`: a new user capability or public contract
- `fix`: a correction to observable behavior or a state invariant
- `refactor`: an ownership or implementation change with no intended behavior change
- `perf`: a measured latency, resource, or energy improvement
- `test`: test-only changes
- `docs`: documentation-only changes
- `build`: dependencies, build logic, packaging, or artifact assembly
- `ci`: continuous integration and release automation
- `chore`: repository maintenance with no product or build behavior change
- `revert`: an explicit reversal of an earlier commit

Choose the narrowest scope that owns the changed state or behavior:

| Scope             | Owner                                                                  |
| ----------------- | ---------------------------------------------------------------------- |
| `agent`           | prompt, context, tool, and model-loop policy                           |
| `annotation`      | persisted content annotations and their interaction contract           |
| `apple-reminders` | bundled Apple Reminders extension commands and domain behavior         |
| `attachments`     | attachment selection, preview, and submitted set                       |
| `checkpoint`      | checkpoint persistence, loading, serialization, and compaction         |
| `clipboard`       | clipboard facts, history, capture, and clipboard-specific actions      |
| `coffee`          | bundled Coffee extension commands and process behavior                 |
| `composer`        | editor, mentions, references, and input drafts                         |
| `computer-use`    | computer-use core and desktop execution coordination                   |
| `content-card`    | structured assistant content, projection jobs, and card registry       |
| `db`              | general Prisma, SQLite, and migration lifecycle                        |
| `deps`            | third-party dependency updates and their lockfile changes              |
| `devtools`        | developer-facing network inspection and debugging surfaces             |
| `diagnostics`     | causal diagnostics, diagnostic bundles, redaction, and inspection      |
| `extension`       | registry, installation, and discovery shared across bundled extensions |
| `extension-cli`   | extension development, build, validation, and publishing commands      |
| `extension-host`  | extension host process, execution lease, and reconciliation            |
| `extension-sdk`   | public extension API, utilities, and package contracts                 |
| `figma-files`     | bundled Figma Files extension commands and domain behavior             |
| `github`          | bundled GitHub extension commands and domain behavior                  |
| `hitl`            | approval requests, decisions, concurrency, and replay                  |
| `launcher`        | launcher commands, search, arguments, and routing                      |
| `main-window`     | main and session window startup, restoration, and activation           |
| `memory`          | personal memory persistence, suggestions, review, and archive          |
| `model-provider`  | provider auth, model catalog, and model capabilities                   |
| `native`          | platform helpers, native protocols, and native artifacts               |
| `notion`          | bundled Notion extension commands and domain behavior                  |
| `release`         | release tags, channels, changelog, and publishing                      |
| `renderer`        | shared renderer infrastructure and view primitives                     |
| `repo`            | root repository policy, contributor metadata, and maintenance          |
| `runtime`         | run lifecycle, recovery, reconnection, and durable terminal state      |
| `settings`        | general settings storage, navigation, and routing                      |
| `thread-digest`   | thread digest generation, persistence, and search projection           |
| `thread-workflow` | thread workflow definitions, management, and runtime automation        |
| `tracing`         | agent trace capture, storage, export, and inspection                   |
| `workspace`       | workspace identity, roots, isolation, and workspace-owned state        |

Commitlint prints the allowed scope list when it encounters an unknown scope;
the table above is the complete owner mapping. The `extension` scope is limited
to the shared registry, installation, and discovery owner. A single bundled
extension must use its extension id, such as `notion`, `coffee`, `github`,
`figma-files`, or `apple-reminders`; host runtime work uses `extension-host`, and
public API or utility work uses `extension-sdk`.

Do not use `agent` for checkpoint, runtime, or approval work; do not use
`launcher` for main-window lifecycle; and do not use `extension` for public SDK
or host-runtime changes. Split a commit when no single owner scope describes it.

Breaking changes use `type(scope)!:` and include a `BREAKING CHANGE:` footer
that explains the migration. Reverts use `revert(scope):` and include
`Reverts: <original SHA>` after the header. Partial commits use `Refs:` or
`Part-of:`; reserve `Fixes:` for a dependency-closed commit or pull request.
Public commit messages must not disclose security exploitation details.

Only actual Git or GitHub merge commits with subjects beginning with `Merge`
bypass commitlint. The local hook requires Git's active `MERGE_HEAD`; CI requires
the stored commit to have at least two parents. A normal single-parent commit
whose subject merely begins with `Merge` fails validation. Contributors must
not create manual merge commits; integrate branches with rebase or squash
instead. Dependency bots receive no blanket exemption and must use
`build(deps): ...`. Release tags are not commit subjects; release preparation
uses `ci(release): ...`, `build(release): ...`, or `docs(release): ...`.

`pnpm install` installs the local `commit-msg` hook. It can also be restored
explicitly with `make setup-hooks`. To check the current commit manually, run:

```bash
pnpm run commitlint:last
```

## Questions

Open a GitHub issue or discussion with a small reproduction, the owning layer you
think is involved, and the checks you already ran.

For support expectations, see [SUPPORT.md](SUPPORT.md). For community conduct,
see [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
