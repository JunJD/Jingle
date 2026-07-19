# Jingle Computer Use Core

This package is the Jingle-owned contract and lifecycle core for desktop computer use.
It deliberately does not expose an MCP or model-tool surface. The runtime adapter is the
only layer allowed to translate this contract into agent tools.

## Invariants

- Observations are immutable, bounded, and identified by `stateId`.
- Semantic refs may remain stable across confidently matched observations, but every
  action and query is owned by one explicit `stateId`.
- Every live desktop resource has a monotonically increasing epoch.
- Mutations advance the epoch before native dispatch, so uncertain execution invalidates
  the base state.
- Authorization is default-deny and bound to run, thread, session, PID, native window,
  and window generation.
- V1 actions require semantic refs. Raw screen or screenshot coordinates are not part of
  the contract.
- Background execution may retry in the foreground only when every requested step returns
  `didnt` with verified no-side-effect evidence. `unknown` is never replayed.
- Cancellation before dispatch is `cancelled_before_dispatch`; cancellation after dispatch
  is `unknown` until a successor observation proves the effect.
- The complete successor observation is the fact. The model normally receives a bounded,
  trustworthy `baseStateId -> successorStateId` diff; diffs are derived projections.
- Initial observation and unsafe diff boundaries return a folded full re-anchor. Root
  replacement, low identity confidence, state eviction, process restart, uncertain external
  mutation, unprotected context compaction, and over-budget diffs cannot continue incrementally.
- Model projections are exact-shaped and byte-bounded. Folded full and query results report
  omitted elements and truncated display fields; a diff is emitted only when its complete
  canonical projection fits the configured budget. The core confidence floor cannot be lowered.
- Search, expand, and inspect query the complete immutable observation by `stateId`; they do not
  query a model-side diff cache.
- OS accessibility events may mark a resource dirty or wake settling, but cannot patch an
  observation in place.

## Platform status

The static capability matrices are fail-closed ceilings. The packaged helpers expose one
raw JSON protocol and may enable only routes accepted by the core probe policy:

- macOS uses Accessibility observations and background AX actions. Mutation support is
  reported only while the process has Accessibility permission.
- Windows ships a real HWND/UI Automation observation backend, but every mutation remains
  `unavailable` until the Windows behavior matrix is accepted.
- Linux ships AT-SPI observation with X11 native-window binding. X11 and every Wayland
  environment keep mutation `unavailable` until their platform behavior matrices are
  accepted; a requested/detected environment mismatch also fails closed.

None of the helpers accepts coordinates, pixel clicks, XTest, SendInput, portals, or other
global-input routes. Native PID, handle, process generation, and accessibility fingerprints
are transient evidence; Jingle's durable window registry remains the caller/run owner.

The native artifact bundle is an additive prerequisite. Production runtime, settings,
approval, persistence, projection, and legacy deletion remain separate dependency-closed
cutover work.

## Ownership and dependency direction

The dependency direction is one-way:

`agent tools/model projection -> application service -> transaction core -> backend SPI -> native transport/platform adapter -> OS`

Native transports and platform adapters cannot import harness, tool, renderer, or persistence
types. Agent tools cannot inspect PID, AX, UIA, AT-SPI, process transport, or native protocol
details. The Pi-like agent contract is the control protocol; CUA-inspired backends are only the
data plane.

State ownership, epochs, stale rejection, run/thread/durable-window authorization, durable CAS
attempt transitions, cancellation boundaries, retry proof, and typed outcomes/evidence are fixed
core truths. Intentional plug points are limited to `ComputerUseBackend`, native transport,
platform adapter, observation enrichment, ref matching/diff projection, ledger port, trace sink,
and test clock/id factories. Core validates matcher confidence and diff completeness, so a plug-in
cannot bypass mandatory full fallback. Production assembly must have one
`createComputerUseRuntime(...)` composition root and must not install another MCP, session, tool,
or result owner.

## Debug modes

The application service will treat `live`, `record`, `replay`, `conformance`, and
`fault_injection` as first-class modes behind the same authorization boundary. Record/replay data
contains correlation ids, capability matrices, state ids and redacted-state hashes, normalized
redacted observations, rendered diff or fallback reason and confidence, epochs, dispatch boundary,
evidence/outcome, and event hints. It never stores secrets and never bypasses authorization.

Diagnostics report route, delivery, verification, fallback, and dispatch. Accessibility event loss
is visible, but events only wake settling or mark a resource dirty; the authoritative post-action
observation remains canonical. A local inspector may compare the complete base, successor, and
model projection without adding another result IPC or execution path.
