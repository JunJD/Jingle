# Native Island Roadmap

This roadmap defines the implementation sequence for replacing the current native overlay spike with a real macOS island surface.

## Goal

Build a persistent native AI presence surface with these properties:

- always-on collapsed presence near the top edge
- short expanded pulse for approval, done, and error events
- clear routing into `LauncherAiPage` and `HistoryApp`
- main-process-owned state, not renderer-owned state

## Boundary

### Main Process

Owns:

- run and session presence truth
- `PresenceStore`
- routing decisions into launcher and history windows
- IPC bridge to native helper

Does not own:

- notch rendering details
- renderer-local visual state

### Native Helper

Owns:

- island rendering
- collapsed and expanded island state
- click and hover handling
- short pulse animation lifecycle

Does not own:

- run truth
- approval truth
- thread persistence

### Renderer Surfaces

`LauncherAiPage` owns fast continuation.

`HistoryApp` owns deep context and history.

Neither surface owns global presence truth.

## Non-Goals

- do not keep the current toast-style overlay as the final shape
- do not let renderer drive island state directly
- do not design a generalized ACP or WebSocket layer for this work

## Execution Plan

### Phase 0 — Freeze Boundaries

Deliverables:

- `roadmap.md`
- `cleanups.md`
- `issue.md`

Exit criteria:

- ownership, sequencing, and deferred work are explicit

### Phase 0.5 — Minimal Native Geometry Spike

Deliverables:

- a standalone Swift helper that renders a collapsed island at the notch
- collapsed size `56x28`
- click toggles expanded size `200x200`
- main process starts and stops the helper, and nothing more

Exit criteria:

- Openwork launch also launches the native island
- the island expands and collapses smoothly on click
- no renderer or session state is involved

### Phase 1 — Replace Notification Contract With Presence Contract

Define a shared contract that models an island instead of a toast.

Deliverables:

- replace `NativeIslandOverlayNotification` with:
  - `PresenceState`
  - `PresencePulse`
  - `PresenceAction`
- replace `show/hide` commands with:
  - `setPresence`
  - `presentPulse`
  - `dismissPulse`

Files expected:

- `src/shared/native-island-overlay.ts`

Exit criteria:

- shared types describe steady-state presence and transient pulse separately

### Phase 2 — Introduce Main-Process PresenceStore

Create one store in main that reduces runtime events into native-friendly presence state.

Deliverables:

- `PresenceStore` in main
- explicit state model for:
  - `idle`
  - `running`
  - `approval`
  - `error`
  - `done-pulse`

Files expected:

- `src/main/services/*`
- `src/main/ipc/agent.ts`

Exit criteria:

- menu bar, island, launcher, and history can all subscribe to one truth source

### Phase 3 — Fix Window Routing Semantics

Stabilize the `Main` window navigation boundary before island actions depend on it.

Deliverables:

- cold-start navigation uses pending payload only
- loaded-window navigation uses live event only
- no stale payload replay after load

Files expected:

- `src/main/index.ts`
- `src/main/windows/main-window.ts`
- `src/main/ipc/main-window.ts`
- `src/renderer/src/ai-core/history.tsx`

Exit criteria:

- opening `HistoryApp` always lands on the final requested thread

### Phase 4 — Build Persistent Collapsed Island

Replace the current popup card with a persistent collapsed island.

Deliverables:

- native helper keeps a long-lived island panel
- collapsed state is always present while app is running
- no more "only show when notified" behavior

Files expected:

- `src/native/openwork-island-overlay.swift`
- `src/main/services/native-island-overlay.ts`

Exit criteria:

- idle/running/approval state is visible without showing a full card

### Phase 5 — Add Expanded Pulse State

Add short-lived expansion from the collapsed island.

Deliverables:

- approval pulse
- done pulse
- error pulse
- one-shot action handling

Exit criteria:

- island expands for important events and collapses back cleanly

### Phase 6 — Connect Launcher And History Routing

Wire island actions into the correct deep surfaces.

Deliverables:

- approval default action resumes in `LauncherAiPage`
- history action opens `HistoryApp` with stable thread selection
- no renderer-direct native control path remains

Exit criteria:

- island actions always land on the correct product surface

### Phase 7 — Remove Compatibility Paths

Delete temporary shims introduced during migration.

Deliverables:

- remove temporary preload bridge
- remove toast-era command names
- remove duplicate state paths

Exit criteria:

- `cleanups.md` active list is empty

### Phase 8 — Validate And Package

Deliverables:

- BDD coverage for `Launcher -> Main` routing
- integration coverage for native helper action lifecycle
- packaged native helper plan is explicit

Exit criteria:

- implementation is testable, repeatable, and not runtime-spike-only

## Order Constraints

- Phase 1 must finish before Phase 4.
- Phase 3 must finish before Phase 6.
- Phase 7 happens only after collapsed and expanded island both work.

## Acceptance

This project is done when all of these are true:

- Openwork always has a visible native AI presence surface on macOS
- approval requests expand from that surface instead of showing a generic toast
- the island does not become the source of truth
- `LauncherAiPage` and `HistoryApp` remain the only deep work surfaces
- temporary migration logic is removed
