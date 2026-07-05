# Jingle Engineering Boundaries

This document captures the engineering boundaries that should remain stable even as product surfaces change.

It defines where implementation responsibility lives. Product positioning can move faster than this file; these engineering boundaries should remain stable unless the owning layer actually changes.

## System Shape

Jingle has five important layers:

1. `launcher`
2. `ambient surfaces`
3. `renderer feature runtimes`
4. `main-process runtime and services`
5. `harness persistence`

If a change blurs these layers, the cost of the next change will go up fast.

## Ownership Boundaries

### Launcher

The launcher is the default entry and recovery shell.

It owns:

- show and hide behavior
- route changes
- home search input and result selection
- opening built-in or extension commands

It does not own:

- long-running agent truth
- persistence
- approval state as a source of truth
- extension runtime internals

Current anchors:

- [LauncherApp.tsx](../src/renderer/src/launcher-shell/LauncherApp.tsx)
- [types.ts](../src/renderer/src/launcher-shell/pages/types.ts)

### Ambient Surfaces

An ambient surface such as tray, menu bar, or notch sentinel is a presence surface.

It owns:

- compressed run state display
- fast return into the launcher or active run

It does not own:

- planning
- approvals as the source of truth
- task execution

If an ambient surface needs run state, it must subscribe to runtime state. It must not become a second runtime.

### Renderer Feature Runtimes

The renderer contains multiple feature surfaces, but they are not interchangeable:

- `launcher-shell` is the shell
- `ai-core` is the first-party AI surface
- `extension-host` is the native extension surface
- `launcher-components` contains shared chrome and presentation components

The important rule is:

`launcher-shell` decides what surface is active, but it does not absorb the state machines of every surface.

Current anchors:

- [src/renderer/src/launcher-shell](../src/renderer/src/launcher-shell)
- [src/renderer/src/ai-core](../src/renderer/src/ai-core)
- [src/renderer/src/extension-host](../src/renderer/src/extension-host)
- [src/renderer/src/launcher-components](../src/renderer/src/launcher-components)

### Main-Process Runtime And Services

The main process owns execution truth.

It owns:

- agent runtime creation
- tool execution and guardrails
- run lifecycle
- checkpoint integration
- search providers
- window services
- persistence orchestration

It should remain the source of truth for anything that must survive renderer refreshes or hidden windows.

Current anchors:

- [runtime.ts](../src/main/agent/runtime.ts)
- [service.ts](../src/main/agent/service.ts)

### Harness Persistence

Harness persistence is not a UI concern.

It owns:

- threads
- runs
- messages
- HITL requests
- checkpoints
- session bindings

Schema and lifecycle changes here affect debugging, replay, approvals, and recovery. Treat them as core product changes, not implementation cleanup.

Current anchors:

- [schema.prisma](../prisma/schema.prisma)
- [persistence.ts](../src/main/agent/persistence.ts)

## Dependency Direction

Prefer this dependency direction:

- `shared/*` is consumed by renderer and main
- `launcher-shell` may depend on `ai-core` and `extension-host`
- `extensions/*` should only touch stable extension APIs
- `main` and `preload` define system bridges
- renderer should not invent durable truth that already belongs in main

Avoid these patterns:

- extension code importing launcher-shell internals
- renderer inventing durable run identities
- launcher shell absorbing feature-specific state machines
- ambient UI reading private renderer state instead of runtime state

## State Ownership Rules

Keep these rules hard:

1. Run lifecycle lives in main.
2. Launcher query and selection state live in launcher-shell.
3. AI page state lives in `ai-core`, not in launcher shell.
4. Extension runtime state lives in `extension-host`, not in launcher shell.
5. Ambient status surfaces consume state; they do not own state.

If a value needs to cross more than one or two component layers, define a boundary object, context, or host API. Do not normalize prop drilling as architecture.

## Command And Entry Model

The current launcher command model already distinguishes behavior, not just pages.

Today there are at least two first-class command modes:

- `view`
- `no-view`

Current anchors:

- [types.ts](../src/renderer/src/launcher-shell/pages/types.ts)

That matters because future additions such as menu bar, notch, background work, or assistant-only entrypoints should not be faked as ordinary pages.

When introducing a new entry shape:

1. define its lifecycle explicitly
2. define its ownership boundary
3. define its failure semantics
4. only then add UI or manifest surface

## Skills And Extensions

Skills and extensions are subordinate to the product core.

Skills are cognitive inputs to the assistant.
Extensions are integration surfaces.
Neither should redefine the product around platform ambition.

Practical rule:

- `AI` remains a first-party platform capability
- extensions must not bypass stable host APIs
- skills must remain readable to the runtime through explicit sources, not hidden JS objects

Current anchor:

- [extension-api](../packages/extension-api/src/index.ts)
- [host-runtime](../packages/extension-api/src/host-runtime.ts)

## Acceptance Standard For Structural Changes

Do not accept a structural change because the code "works on my machine".

A change in launcher, extension, runtime, or harness structure should pass four checks:

1. `contract`
   shared types and ownership boundaries are explicit
2. `demo path`
   a real user workflow proves the change
3. `auto-check`
   type checks, targeted tests, or guardrails catch regression
4. `failure semantics`
   missing config, denied capability, or runtime failure fails explicitly

If one of these is missing, the design is not settled.

## Known Constraints Worth Preserving

These older conclusions still have value and should remain true:

- launcher-shell is an entry shell, not an extension runtime
- AI is a first-party capability, not just another plugin
- main-process runtime should stay authoritative for durable execution state
- host capabilities should remain explicit rather than implicit global access
- product-specific control surfaces matter more than generic platform symmetry

## What To Leave Dead

Do not resurrect old docs just because they contain effort.

The following classes of documents are intentionally gone:

  - phase roadmaps that no longer describe the current product
- competitor comparison dumps
- extension-platform expansion plans that outrun the product thesis
- design previews and screenshot artifacts

If a deleted document only described a path the product no longer wants, keep it deleted.
