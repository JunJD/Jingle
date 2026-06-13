# Openwork Documentation Index

[中文文档索引](./README-cn.md)

This index organizes the repository docs by their production-readiness use. The category explains how to read a document today; it does not mean every older document has already been rewritten.

Status legend:

- `current`: usable as a current implementation or workflow entrypoint, but still verify related code paths before editing.
- `refresh`: important topic, but the document needs to be rewritten or compressed against current code before it becomes a production entrypoint.
- `archive`: historical research, roadmap, proposal, or background; do not treat it as a current implementation contract.
- `content`: launch, narrative, article, or marketing material; not user help or developer contract.

## New Developer Reading Order

When you first join Openwork/Jingle work, start from current code facts and release governance. Do not infer current behavior from historical research docs.

1. [production-readiness/README.md](./production-readiness/README.md): production release governance entrypoint.
2. [production-readiness/production-feature-inventory.md](./production-readiness/production-feature-inventory.md): current features, user entrypoints, owner paths, and release gaps.
3. [dev/README.md](./dev/README.md), [dev/validation-matrix.md](./dev/validation-matrix.md), and [dev/release-runbook.md](./dev/release-runbook.md): current development, validation, and release entrypoints.
4. [engineering-boundaries.md](./engineering-boundaries.md) and [runtime-invariants.md](./runtime-invariants.md): engineering boundaries and runtime invariants; still useful, but should be refreshed before production publication.
5. [dev/extension-development.md](./dev/extension-development.md), [extension-package-contract.md](./extension-package-contract.md), and [installable-extension-dev-guide-cn.md](./installable-extension-dev-guide-cn.md): extension package contract and installable extension development entrypoints.
6. [agent-activity-runtime-to-ui-cn.md](./agent-activity-runtime-to-ui-cn.md) and [ai-launcher-streaming-performance-boundaries-cn.md](./ai-launcher-streaming-performance-boundaries-cn.md): current agent runtime -> renderer projection -> UI boundary notes.
7. [openwork-electron-debugging.md](./openwork-electron-debugging.md), [macos-dev-preview-install.md](./macos-dev-preview-install.md), and [openwork-electron-size-performance-optimization.md](./openwork-electron-size-performance-optimization.md): debugging, preview install, and packaging-quality entrypoints.

Migration docs, Raycast comparisons, old proposals, and launch copy should not be used as current implementation contracts. They are grouped in the history/content sections below.

## Production Release Governance

| Status  | Document                                                                                                                       | Purpose                                        |
| ------- | ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------- |
| current | [production-readiness/README.md](./production-readiness/README.md)                                                             | Production release governance entrypoint       |
| current | [production-readiness/production-feature-inventory.md](./production-readiness/production-feature-inventory.md)                 | Current feature inventory, entrypoints, owners |
| current | [production-readiness/documentation-audit.md](./production-readiness/documentation-audit.md)                                   | Docs keep / rewrite / archive / delete audit   |
| current | [production-readiness/code-classification-governance.md](./production-readiness/code-classification-governance.md)             | Product/dev/test/docs/archive classification   |
| current | [production-readiness/help-center-information-architecture.md](./production-readiness/help-center-information-architecture.md) | Help center information architecture           |
| current | [production-readiness/blog-topics-and-outlines.md](./production-readiness/blog-topics-and-outlines.md)                         | Launch content topics and outlines             |
| current | [production-readiness/execution-waves.md](./production-readiness/execution-waves.md)                                           | Four-wave execution plan                       |

## User Help Entry

The help center is the user entrypoint. Historical research docs should not be used as user help.

| Status  | Document                                                                                                                       | Purpose                                           |
| ------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------- |
| current | [help/README.md](./help/README.md)                                                                                             | User help center entrypoint                       |
| current | [help/getting-started/install-and-open.md](./help/getting-started/install-and-open.md)                                         | Install, open, and first setup                    |
| current | [help/getting-started/configure-a-model.md](./help/getting-started/configure-a-model.md)                                       | Settings -> Models setup                          |
| current | [help/getting-started/first-agent-run.md](./help/getting-started/first-agent-run.md)                                           | First agent run                                   |
| current | [help/core-concepts/workspace.md](./help/core-concepts/workspace.md)                                                           | Workspace trust boundary                          |
| current | [help/core-concepts/permission-modes.md](./help/core-concepts/permission-modes.md)                                             | Permission modes and approval cards               |
| current | [help/extensions/overview.md](./help/extensions/overview.md)                                                                   | Extension user entrypoints, connections, and AI   |
| current | [help/logs-and-diagnostics/find-logs.md](./help/logs-and-diagnostics/find-logs.md)                                             | Local log location and support redaction          |
| current | [help/faq.md](./help/faq.md)                                                                                                   | Frequently asked questions                        |
| current | [macos-dev-preview-install.md](./macos-dev-preview-install.md)                                                                 | macOS unsigned / unnotarized preview install help |
| current | [production-readiness/help-center-information-architecture.md](./production-readiness/help-center-information-architecture.md) | Future help-center IA, not final user reading     |

## Current Engineering Contracts And Dev Entry

These are current developer entrypoints or engineering contracts. Some still need to be shortened and refreshed before production publication.

| Status  | Document                                                                                               | Purpose                                                                 |
| ------- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| current | [dev/README.md](./dev/README.md)                                                                       | Development entrypoint, owner paths, and quality gate selection         |
| current | [dev/validation-matrix.md](./dev/validation-matrix.md)                                                 | BDD, node tests, guardrails, build/package command matrix               |
| current | [dev/release-runbook.md](./dev/release-runbook.md)                                                     | npm release, desktop release, and local packaging runbook               |
| current | [dev/extension-development.md](./dev/extension-development.md)                                         | Extension source roots, build/dev commands, guardrail coverage          |
| refresh | [engineering-boundaries.md](./engineering-boundaries.md)                                               | Engineering boundaries, module responsibility, dependency direction     |
| refresh | [runtime-invariants.md](./runtime-invariants.md)                                                       | Runtime invariants and execution constraints                            |
| refresh | [extension-package-contract.md](./extension-package-contract.md)                                       | Built-in / bundled installable / user-installed package contract        |
| current | [extension-migration-transform-architecture-cn.md](./extension-migration-transform-architecture-cn.md) | Extension migration transform layers, fixtures, generated output checks |
| refresh | [installable-extension-dev-guide-cn.md](./installable-extension-dev-guide-cn.md)                       | Installable extension external source package guide                     |
| current | [renderer-external-store-architecture.md](./renderer-external-store-architecture.md)                   | Renderer external store architecture                                    |
| refresh | [thread-lifecycle-contract-cn.md](./thread-lifecycle-contract-cn.md)                                   | Thread lifecycle, fork, HITL, and resume contract draft                 |
| refresh | [model-provider-design.md](./model-provider-design.md)                                                 | Model provider implementation notes needing refresh                     |
| current | [openwork-electron-debugging.md](./openwork-electron-debugging.md)                                     | Electron debugging flow and local verification                          |
| current | [launcher-ui-audit-harness.md](./launcher-ui-audit-harness.md)                                         | Launcher UI runtime style audit entrypoint                              |

## Agent, Renderer, And State

| Status  | Document                                                                                                   | Purpose                                                                |
| ------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| current | [agent-activity-runtime-to-ui-cn.md](./agent-activity-runtime-to-ui-cn.md)                                 | Agent activity from runtime event, shared state, projection, and UI    |
| current | [agent-event-state-trace-final-cn.md](./agent-event-state-trace-final-cn.md)                               | Agent event / state / trace design background                          |
| current | [ai-launcher-streaming-performance-boundaries-cn.md](./ai-launcher-streaming-performance-boundaries-cn.md) | AI launcher streaming render performance boundary and regression guard |
| archive | [messages-perceived-waiting-upgrade-plan-cn.md](./messages-perceived-waiting-upgrade-plan-cn.md)           | Historical perceived-waiting UX plan                                   |
| archive | [artifact-tab-roadmap.md](./artifact-tab-roadmap.md)                                                       | Artifact tab roadmap                                                   |

## Extensions, Connections, And Migration

| Status  | Document                                                                                                     | Purpose                                                                          |
| ------- | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| refresh | [extension-auth-connection-architecture-cn.md](./extension-auth-connection-architecture-cn.md)               | Extension auth / connection architecture needing compression into current docs   |
| refresh | [extension-connector-runtime-design.md](./extension-connector-runtime-design.md)                             | Command, AI capability, connection, `@extension` / `loadExtension` runtime notes |
| archive | [extension-runtime-architecture-research-cn.md](./extension-runtime-architecture-research-cn.md)             | Extension runtime isolation, remote rendering, external research                 |
| archive | [extension-external-install-packaging-research-cn.md](./extension-external-install-packaging-research-cn.md) | External install and packaging research                                          |
| archive | [extension-runtime-migration-plan.md](./extension-runtime-migration-plan.md)                                 | Extension command runtime migration plan                                         |
| archive | [installable-extension-runtime-v1-proposal-cn.md](./installable-extension-runtime-v1-proposal-cn.md)         | Historical Installable Extension Runtime V1 proposal                             |
| archive | [extension-hitl-experience-architecture.md](./extension-hitl-experience-architecture.md)                     | Extension HITL experience proposal                                               |
| archive | [extension-hitl-experience-detailed-design-cn.md](./extension-hitl-experience-detailed-design-cn.md)         | Extension HITL detailed Chinese design                                           |
| archive | [raycast-notion-dependency-migration-preview.md](./raycast-notion-dependency-migration-preview.md)           | Notion migration state and Raycast dependency evidence                           |

## Desktop, Native Capability, And Runtime Quality

| Status  | Document                                                                                                   | Purpose                                                                     |
| ------- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| refresh | [openwork-native-readiness-audit.md](./openwork-native-readiness-audit.md)                                 | Native-readiness audit needing current-code refresh                         |
| refresh | [windows-support-gap-audit.md](./windows-support-gap-audit.md)                                             | Windows support gap audit needing package/workflow/native-extension refresh |
| current | [launcher-window-snap-overlay-architecture-cn.md](./launcher-window-snap-overlay-architecture-cn.md)       | Launcher snap overlay and window behavior                                   |
| current | [openwork-electron-size-performance-optimization.md](./openwork-electron-size-performance-optimization.md) | Electron size, startup, and runtime performance optimization notes          |

## Memory And Product Plans

| Status  | Document                                                                                             | Purpose                                            |
| ------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| refresh | [personal-agent-memory-product-plan.md](./personal-agent-memory-product-plan.md)                     | Personal agent memory product plan                 |
| refresh | [personal-agent-memory-technical-overview.md](./personal-agent-memory-technical-overview.md)         | Personal agent memory technical overview           |
| content | [personal-agent-memory-implementation-article.md](./personal-agent-memory-implementation-article.md) | Personal agent memory implementation article draft |

## Product, Market, And Content Assets

These docs can support launch content, product judgment, or article material. Do not treat them as current developer contracts.

| Status  | Document                                                                                                     | Purpose                                                   |
| ------- | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------- |
| content | [product-narrative.md](./product-narrative.md)                                                               | Product narrative, positioning, and experience background |
| content | [blog-drafts/README.md](./blog-drafts/README.md)                                                             | Production launch blog drafts entrypoint                  |
| content | [blog-drafts/product-launch-introduction.md](./blog-drafts/product-launch-introduction.md)                   | Product launch introduction draft                         |
| content | [blog-drafts/launcher-to-agent-workflow.md](./blog-drafts/launcher-to-agent-workflow.md)                     | Product/design essay about launcher-to-agent workflow     |
| content | [blog-drafts/local-first-agent-workspace.md](./blog-drafts/local-first-agent-workspace.md)                   | Local-first agent workspace draft                         |
| content | [blog-drafts/extension-runtime-design.md](./blog-drafts/extension-runtime-design.md)                         | Extension/runtime design draft                            |
| content | [blog-drafts/production-logs-and-diagnostics.md](./blog-drafts/production-logs-and-diagnostics.md)           | Production logs and diagnostics draft                     |
| content | [launch/openwork-launch-thread-cn.md](./launch/openwork-launch-thread-cn.md)                                 | Openwork launch thread Chinese draft                      |
| content | [launch/raycast-experience-independent-thought-cn.md](./launch/raycast-experience-independent-thought-cn.md) | Raycast / Openwork product judgment article               |
| archive | [launch/raycast-v2-windows-rewrite-research-cn.md](./launch/raycast-v2-windows-rewrite-research-cn.md)       | Raycast V2 Windows rewrite external research              |
| archive | [harness-engineering-dimensions-research-cn.md](./harness-engineering-dimensions-research-cn.md)             | Harness engineering dimensions product research           |
| archive | [ai-launcher-intent-recognition-research.md](./ai-launcher-intent-recognition-research.md)                   | On-device AI launcher intent recognition research         |
| archive | [openwork-ui-upgrade-research.md](./openwork-ui-upgrade-research.md)                                         | UI upgrade direction research                             |
| archive | [codex-desktop-openwork-agent-harness-gap-cn.md](./codex-desktop-openwork-agent-harness-gap-cn.md)           | Codex Desktop and Openwork harness gap research           |
| archive | [codex-launcher-ai-chrome-path-map-cn.md](./codex-launcher-ai-chrome-path-map-cn.md)                         | Codex-style launcher AI chrome path map                   |
| archive | [codex-launcher-pinned-session-window-plan-cn.md](./codex-launcher-pinned-session-window-plan-cn.md)         | Codex-style pinned session window plan                    |
| archive | [codex-turn-diff-research-cn.md](./codex-turn-diff-research-cn.md)                                           | Codex turn diff / edited files research                   |
| archive | [task-parallelization-and-conflict-plan.md](./task-parallelization-and-conflict-plan.md)                     | Parallel task split and conflict-boundary delivery        |
| archive | [tsyringe-migration-roadmap.md](./tsyringe-migration-roadmap.md)                                             | tsyringe migration roadmap                                |
| archive | [openwork-project-share.pptx](./openwork-project-share.pptx)                                                 | Historical share deck                                     |

## Maintenance Rules

- Put new user help under `docs/help`, and link it from the user help section of this index.
- For new developer contracts or runbooks, state owner paths, verification, and failure semantics.
- Put launch articles or market content in the content section, not in user help or engineering contracts.
- Keep old proposals and research, but mark them `archive` so they do not mislead production release work.
- When a doc mentions scripts, workflows, or code paths, verify against `package.json`, `.github/workflows`, and `rg --files`.
