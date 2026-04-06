# Openwork Runtime Invariants

This document records runtime and persistence rules that future implementation work should not casually violate.

Use it when changing:

- `src/main/agent/**`
- `src/main/ipc/agent.ts`
- `src/main/db/**`
- `prisma/schema.prisma`

## Single Durable Store

Openwork uses one SQLite database accessed through Prisma.

Current anchor:

- [schema.prisma](/Users/junjieding/dingjunjie_dev/2026_03/openwork/prisma/schema.prisma)

Rules:

1. schema changes go through Prisma migrations
2. do not rely on runtime auto-migration as normal behavior
3. checkpoint data remains first-class, not an afterthought hidden inside another table

## Durable Runtime Entities

These entities carry the harness:

- `Thread`
- `Run`
- `Message`
- `HitlRequest`
- `Checkpoint`
- `SessionBinding`

Responsibility split:

- `Thread` is the durable conversation and checkpoint container
- `Run` is one execution lifecycle on a thread
- `Message` is durable conversation state
- `HitlRequest` is durable approval state
- `Checkpoint` and `CheckpointWrite` are runtime recovery state
- `SessionBinding` maps a stable session key to the current thread

If a change makes these responsibilities blur together, debugging and replay quality will degrade.

## Run Lifecycle Truth Lives In Main

Run creation and status transitions happen in main.

Current anchors:

- [persistence.ts](/Users/junjieding/dingjunjie_dev/2026_03/openwork/src/main/agent/persistence.ts)
- [agent.ts](/Users/junjieding/dingjunjie_dev/2026_03/openwork/src/main/ipc/agent.ts)

Current behavior that should remain explicit:

- starting a run persists a `Run` row and a user `Message`
- one active stream per thread is enforced in main
- thread status is updated in main as runs move through `running`, `interrupted`, `error`, or `success`

Do not move durable run truth into renderer state.

## Approval Interception Point

Shell execution approval is enforced before tool execution, not after.

Current anchor:

- [execute-approval-middleware.ts](/Users/junjieding/dingjunjie_dev/2026_03/openwork/src/main/agent/execute-approval-middleware.ts)

Important invariant:

- `execute` approval happens inside `wrapToolCall`
- `toolCall.id` is the authoritative identifier for linking approval to execution
- allowed decisions are explicit: `approve`, `reject`, `edit`

If this moves later in the flow, the system loses reliable linkage between the model-emitted tool call and the user-visible approval.

## HITL Persistence Must Be Real

Pending approvals are not temporary UI state.

Current anchor:

- [agent.ts](/Users/junjieding/dingjunjie_dev/2026_03/openwork/src/main/ipc/agent.ts)

Required behavior:

- pending HITL requests are persisted from the stream
- approval resolution updates durable state
- renderer refresh or relaunch must be able to rediscover the pending action

If approvals stop being durable, Openwork stops being a trustworthy harness.

## Message Identity Caution

Main already generates durable ids for persisted user messages and runs.

Current anchors:

- [persistence.ts](/Users/junjieding/dingjunjie_dev/2026_03/openwork/src/main/agent/persistence.ts)
- [runtime-state.ts](/Users/junjieding/dingjunjie_dev/2026_03/openwork/src/main/agent/runtime-state.ts)

Important caution:

- persisted entities in main are authoritative
- checkpoint extraction still contains fallback-style identity recovery for some historical/runtime messages
- renderer-generated UUIDs are not a safe foundation for durable message semantics

Do not design branching, replay, or approval recovery features as if every renderer id is canonical.

## Current Structural Constraint

One important current behavior is still product-significant:

- the active run is aborted when the originating window is fully closed

Current anchor:

- [agent.ts](/Users/junjieding/dingjunjie_dev/2026_03/openwork/src/main/ipc/agent.ts)

This is not just a UI detail. It is a lifecycle choice with product impact.

Future work may change it, but until it changes, treat window closure and run survival semantics as a deliberate system boundary, not an accident hidden in event wiring.

## Recovery Semantics

Checkpoint sync is best-effort during failure and abort handling, but status preservation is mandatory.

Current anchor:

- [persistence.ts](/Users/junjieding/dingjunjie_dev/2026_03/openwork/src/main/agent/persistence.ts)

What matters:

- a checkpoint sync failure should not erase the fact that a run failed or was interrupted
- thread status and run status must still converge to a durable state

## Verification Checklist

When changing runtime or persistence behavior, verify at least these:

1. starting a run creates durable run state
2. approvals persist and reconnect after reload
3. rejecting an `execute` tool call prevents actual execution
4. interrupted or failed runs still leave a readable durable status
5. schema changes preserve replay and history expectations

If the change touches cross-process behavior, prefer a BDD scenario over a narrow unit test.
