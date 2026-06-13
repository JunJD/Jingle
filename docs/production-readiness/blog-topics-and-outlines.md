# Blog Topics And Draft Outlines

These are production launch/content assets. Wave 4 drafted them under
`docs/blog-drafts`. Blog claims must still be checked against
`production-feature-inventory.md` and the final release artifact before
publication.

## 1. Product Launch Introduction

Working title: `Introducing Openwork/Jingle: a local-first desktop workspace for delegated agent work`

Draft: [product-launch-introduction.md](../blog-drafts/product-launch-introduction.md)

Audience:

- People who want AI agents to do real work on their computer without losing visibility or control.

Core thesis:

- The product is not just a chat box and not just a launcher. It is a desktop workspace where delegated work has a visible lifecycle: start, inspect, approve, pause, resume, recover, and keep evidence.

Outline:

1. The problem: AI can act, but users often cannot see what happened or recover safely.
2. The product: launcher entry, agent threads, workspace context, permission modes, artifacts, history.
3. Local-first posture: workspace files, local memory, local logs, user-controlled settings.
4. Extensions: Todo, Translate, Image Generation, Apple Reminders, GitHub, Notion, Figma Files.
5. Trust surfaces: approvals, command guardrails, diagnostics, persistent history.
6. What is ready now and what is intentionally not claimed.
7. Call to action: install/open, configure a model, run the first task.

Evidence to verify:

- Window/root paths in `src/main/index.ts` and `src/renderer/src/main.tsx`.
- Settings and model setup paths.
- Extension manifests and BDD coverage.

## 2. Local-First Agent Workspace

Working title: `Why agent work should have a local workspace, not just a prompt box`

Draft: [local-first-agent-workspace.md](../blog-drafts/local-first-agent-workspace.md)

Audience:

- Power users, builders, privacy-conscious users, and teams evaluating desktop agents.

Core thesis:

- A local-first agent workspace gives users sovereignty over files, memory, logs, and recovery. The agent gets useful context without turning every task into remote black-box state.

Outline:

1. Prompt boxes forget; local workspaces remember with boundaries.
2. Workspace as trust boundary: what the agent can see and modify.
3. Threads and checkpoints as recoverable work state.
4. Memory as user-controlled product data, not invisible model magic.
5. Logs and diagnostics as support tools, not surveillance.
6. What local-first does not mean: no blanket promise that every external provider is local.
7. Practical workflow example: choose workspace -> run task -> approve command -> inspect artifact -> branch.

Evidence to verify:

- `src/main/workspace`, `src/main/openwork-memory`, `prisma/schema.prisma`, `src/main/diagnostics`.

## 3. Extension / Runtime Design

Working title: `Designing extensions for agent workflows: commands, surfaces, and AI capabilities`

Draft: [extension-runtime-design.md](../blog-drafts/extension-runtime-design.md)

Audience:

- Developers and technical users interested in the Openwork extension model.

Core thesis:

- Extensions need two faces: a user-facing command surface and an assistant-facing capability surface. The runtime should keep package contracts, connection/auth, rendering, storage, and AI tools separate enough to debug.

Outline:

1. Why extension design gets harder in an agent workspace.
2. Package roots: built-in, bundled installable, user-installed.
3. Manifest as current source of extension truth.
4. Runtime command surfaces: view, no-view, menu-bar.
5. AI capability catalog: lightweight by default, load details on demand.
6. Connection/auth boundary: settings and OAuth are platform-owned.
7. Rendering boundary: runtime snapshots, renderer host, no UI guessing.
8. Testing boundary: package contract checks, runtime reconciler tests, BDD.

Evidence to verify:

- `src/main/extensions/registry`, `src/main/services/extension-runtime`, `src/extension-runtime`, `src/renderer/src/extension-host`, `packages/extension-api`, `installable-extensions/*/manifest.ts`.

## 4. Production-Grade Logs And Diagnostics

Working title: `The boring feature every desktop agent needs: local logs and diagnostics`

Draft: [production-logs-and-diagnostics.md](../blog-drafts/production-logs-and-diagnostics.md)

Audience:

- Users and engineers who care about supportability.

Core thesis:

- Agent products need observable failure signals. When work spans model calls, file edits, shell commands, renderer windows, native helpers, and OAuth, logs are not a developer luxury; they are part of product trust.

Outline:

1. The support problem: "it failed" is not enough.
2. What to log: app lifecycle, renderer failures, window events, process crashes, extension connection failures.
3. What not to log: secrets, full workspace content, unnecessary model payloads.
4. Local rotating logs under app data / `OPENWORK_HOME`.
5. Renderer-to-main error reports.
6. How diagnostics complement BDD and node tests.
7. Support workflow: reproduce -> collect log -> map to owner path -> fix.

Evidence to verify:

- `src/main/diagnostics/logger.ts`, `src/main/diagnostics/electron-events.ts`, `src/preload/api/diagnostics.ts`, `src/renderer/src/lib/diagnostics.ts`, `tests/node/diagnostics.test.ts`.

## 5. From Launcher To Agent Workflow

Working title: `The launcher is the doorway; the workflow is the product`

Draft: [launcher-to-agent-workflow.md](../blog-drafts/launcher-to-agent-workflow.md)

Audience:

- Product/design/engineering readers.

Core thesis:

- A launcher wins the invocation moment. An agent workspace must also own the lifetime of the work after invocation: context, approvals, progress, evidence, and recovery.

Outline:

1. Launchers are great at calling up intent.
2. Agent work is longer-lived than a command.
3. Openwork/Jingle product loop: search -> open AI/command -> run -> approve -> inspect -> continue.
4. Why history and artifacts matter.
5. Why permission modes belong in the core product surface.
6. How extensions turn launcher commands into durable workflows.
7. Design principle: keep the first move fast, keep the rest inspectable.

Evidence to verify:

- `src/renderer/src/launcher-shell/LauncherApp.tsx`, `src/renderer/src/ai-core/LauncherAiPage.tsx`, `src/main/agent`, `src/main/threads`, `src/main/artifacts`.

## Drafting Order

Wave 4 should draft in this order:

1. Product launch introduction.
2. From launcher to agent workflow.
3. Local-first agent workspace.
4. Extension/runtime design.
5. Production-grade logs and diagnostics.

The first two are launch-facing. The last three can be deeper technical or product essays once docs and diagnostics are stable.
