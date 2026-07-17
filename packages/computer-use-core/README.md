# Jingle Computer Use Core

This package is the Jingle-owned contract and lifecycle core for desktop computer use.
It deliberately does not expose an MCP or model-tool surface. The runtime adapter is the
only layer allowed to translate this contract into agent tools.

## Invariants

- Observations are immutable, bounded, and identified by `stateId`.
- Semantic element refs are valid only inside the observation that created them.
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
- The complete successor observation is the fact. UI diffs are derived projections.

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
