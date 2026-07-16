# Content annotation provenance

Jingle's content annotation implementation is owned by Jingle's typed content-card, main-process
storage, terminal projection, and renderer boundaries. Stable part IDs live in Jingle's
main-owned `assistant_content_projections` and `assistant_content_parts` tables; checkpoint
message metadata and React state are not identity owners. The implementation does not copy Plannotator UI, branding, DOM-path
anchors, state ownership, or source code.

The design review used these reference implementations:

- `backnotprop/plannotator` at `0490cf0f91c1bec1cbe199ecfe682f1827dd5532`, licensed
  `MIT OR Apache-2.0`. Jingle studied its annotation lifecycle, resolver-adapter separation,
  marker/sidebar coordination, and review-submission workflow.
- `craft-ai-agents/craft-agents-oss` at `4289b16097322e9911d3078d8a64bd8c830717c3`, licensed
  `Apache-2.0`. Jingle studied its message-level fullscreen behavior and render-time rich-block
  projection, while deliberately replacing render-time hashes with durable content-part IDs.

No runtime dependency or copied source from either repository is included. If a future change
imports code or assets, it requires a separate license and notice review.
