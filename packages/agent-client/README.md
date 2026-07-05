# @jingle/agent-client

Non-React client utilities for the Jingle agent-to-UI boundary.

This package is being extracted from the renderer agent boundary one owner at a time. It currently owns revision cursor / gap selection, the non-React runtime client coordination for event subscription, pending-gap queueing, snapshot resync, replay, and cleanup, pure command-state selection, command envelope, metadata patch, command-readiness helpers for invoke/edit/resume, queued follow-up drain policy, generic runtime event/source-state contracts, runtime event application into source agent state, snapshot source-state application policy for stale/live runtime protection, live run/tool-call fact shapes consumed by shared runtime adapters and React view projections, active-run bootstrap projection from messages/pending approval, plus the threadId-keyed state store kernel used by renderer adapters.

It does not own durable state, execute agents, render React, read LangGraph checkpoints, or import LangChain / Prisma / Electron main implementation.

## Migration Target

The cursor code replaces the old renderer-local `src/renderer/src/lib/thread-runtime-batch.ts` helper. `createJingleAgentRuntimeClient` replaces the renderer-local subscription / pending-gap / resync implementation from `src/renderer/src/lib/agent-runtime-manager.ts`; that renderer file now only adapts `window.api` and `ThreadStore` into package ports.

The cursor/runtime manager boundary only requires a minimal `{ threadId, latestRevision, events: [{ revision, type }] }` batch contract plus string runtime status. It no longer imports the app shared runtime event types. `runtime-events.ts` owns only ordered batch application and changed-message reporting; the renderer adapter injects the current runtime reducer until AG-UI/Jingle profile events become the client store input.

`createJingleAgentRuntimeClient` does not hard-code product event names. Host adapters own product refresh policy through `shouldRefreshThreadHistory(events)`, so Jingle can refresh thread history after `run.finished` / `approval.requested` without making the client package understand app `AgentThreadEvent` semantics.

`JingleRuntimeEventBatch<TEvent>` and `JingleAgentRuntimeReplayOptions` own the runtime subscription / replay envelope across main, preload, and renderer adapters. The current `AgentThreadEvent` payload remains only as app-specific event content produced by the runtime adapter; envelope ownership lives in this package.

`JingleActiveAgentRun` and `JingleActiveAgentToolCall` own the live run/tool-call fact shape and pure list/patch helpers. `JingleAgentThreadEvent` owns the generic runtime event contract, `JingleAgentThreadRuntimeState` plus `createJingleAgentThreadRuntimeState` own the generic thread runtime source-state shape and empty-state initialization, and `reduceJingleAgentThreadRuntimeEvent` owns the runtime event -> source-state reducer. `src/shared/agent-thread-contract.ts` only binds Jingle `Message` / HITL / todo / context / error types to this contract. `@jingle/agent-react` reuses this client shape for view projections instead of duplicating fields.

Jingle profile vocabulary that is needed by runtime clients lives in this package. App code should consume token/todo/runtime/tool-execution profile types through `@jingle/agent-client` or `@jingle/agent-react`.

`deriveJingleActiveRunFromMessages` owns the non-React active-run bootstrap projection from a projected message list plus pending approval. `src/shared/agent-thread-bootstrap.ts` keeps only the Jingle `AgentThreadDataSnapshot` adapter and no longer has a separate `agent-run-bootstrap` helper.

`createJingleThreadStateStore` owns generic threadId-keyed snapshot storage, subscription, ensure, delete, and immutable update emission. `src/renderer/src/lib/thread-store-core.ts` still owns the Jingle-specific `agent/view/ui` state shape, artifact/tab local state, `window.api` follow-up controls, and message projection adapters.

`selectJingleAgentCommandState`, `buildJingleAgentCommandMessage`, `resolveJingleAgentFollowUpPlan`, `resolveJingleAgentFollowUpDrainPlan`, `resolveJingleAgentInvokeReadiness`, `resolveJingleAgentEditReadiness`, `resolveJingleAgentResumeReadiness`, and `buildJingleAgentResumeDecision` replace the renderer-local command facts selection / command message / follow-up / follow-up-drain / command-readiness / HITL resume envelope construction in `src/renderer/src/lib/thread-context.tsx`, `src/renderer/src/lib/agent-control.ts`, and `src/renderer/src/lib/use-agent.ts`; those renderer files keep store lookup, preload transport calls, runtime-state lookup, React effect ownership, and local error ownership.

The command layer now owns its follow-up command mode/action types, queued follow-up item/summary view contract, queue summary builders including the empty summary constructor, pending-approval resume reference shape, and command envelope orchestration. `message-content.ts` owns the JSON-safe composer payload conversion used for invoke/edit commands. It no longer imports app-local follow-up, thread runtime, HITL, or message-content types.

Jingle shared `message-content.ts` now delegates command-submit content checks/builders to `@jingle/agent-client`; it keeps only display/edit round-trip, metadata refs parsing, assistant display conversion, and product message helpers.

The preload/main IPC command boundary also consumes `JingleAgentFollowUpAction`, `JingleAgentFollowUpQueueItem`, and `JingleAgentFollowUpQueueSummary` for invoke follow-up steering, queue item restore/take operations, and runtime queue facts.

`buildJingleAgentModelMetadataUpdate` and `buildJingleAgentPermissionMetadataUpdate` replace renderer-local thread metadata patch construction in `src/renderer/src/lib/agent-control.ts`; that renderer file keeps thread loading, update transport, and snapshot reload ownership.

`applyJingleRuntimeEvents` replaces the renderer-local event application loop in `src/renderer/src/lib/agent-runtime-event-projector.ts`; that renderer file keeps the current `AgentThreadEvent` reducer adapter, message stability, and messageProjection ownership.

`resolveJingleSnapshotApplicationPolicy` and `applyJingleRuntimeSnapshotSourceState` replace the renderer-local stale/live snapshot guard and source-state runtime fact preservation in `src/renderer/src/lib/agent-runtime-snapshot-reducer.ts`; that renderer file keeps Jingle metadata, permission, artifact, fork/workspace, reference-stability, and messageProjection ownership.

AG-UI transport and a package-owned immutable snapshot store are not part of the current migration. Add them only after a renderer/client path actually consumes that stream and replaces an existing Jingle adapter.

Do not keep renderer-local duplicates after a migration batch lands.
