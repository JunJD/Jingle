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

The static capability matrices are fail-closed ceilings. A capability remains
`unavailable` until its Jingle native backend and environment-specific behavior matrix are
accepted. Linux is split into X11, GNOME Wayland, KDE Wayland, and other Wayland because
their accessibility, portal, capture, focus, and input guarantees are not interchangeable.

The current package is cached-ready core infrastructure. Runtime mutation integration must
be stacked on the committed runtime terminal/settlement contract so run cancellation and
native action facts cannot disagree.
