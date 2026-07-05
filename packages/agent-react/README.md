# @jingle/agent-react

React adapters for the Jingle agent-to-UI boundary.

This package is being extracted from the renderer React subscription path one owner at a time. It currently owns the generic external-store selector hook used by renderer thread selectors, active message projection selection policy used by renderer message projections, reference-stability helpers for projection reuse, active turn status / run coach projection, agent activity summary projection, tool activity visibility policy, tool execution view projection, turn elapsed projection, the reusable tool renderer registry mechanism used by chat tool components, and pure runtime-error / agent-view-state projection for agent UI consumption. Live run/tool-call source shapes and durable tool-execution metadata readers come from `@jingle/agent-client`, not from duplicated React-local interfaces.

It does not own durable state, execute agents, render Jingle chat UI, access Electron APIs, read LangGraph checkpoints, or import LangChain / Prisma / Electron main implementation.

## Migration Target

`useJingleExternalStoreSelector` replaces the renderer-local `useSyncExternalStore` selector wiring in `src/renderer/src/lib/thread-context.tsx`.

`selectJingleActiveMessageProjectionInput`, `canReuseJingleMessageProjection`, and `findJingleChangedAssistantMessage` replace renderer-local active-run-to-message-projection selection, no-message-change reuse, and changed-assistant fast-path selection in `src/renderer/src/lib/agent-runtime-event-projector.ts` and `src/renderer/src/lib/agent-runtime-snapshot-reducer.ts`; those renderer files keep Jingle message projection and source-state adapter ownership.

`createJingleToolRendererRegistry` replaces the renderer-local registry map in `src/renderer/src/components/chat/tools/registry-core.ts`; that renderer file now only binds Jingle-specific `ToolComponentDefinition` and exports app-owned registration helpers.

`resolveJingleAgentViewState` replaces the renderer-local error formatting and busy/canStop/error view-state derivation in `src/renderer/src/lib/use-agent.ts`; that renderer hook keeps command wiring, local dismissed-error state, follow-up drain effect, and transport calls. The pure queued follow-up drain policy belongs to `@jingle/agent-client`.

`projectJingleAgentActivitySummary` replaces the renderer-local grouped tool activity summary policy from `src/renderer/src/lib/message-projection.ts`. The package owns tool category/count/status projection from minimal tool facts; renderer chat code keeps product copy, icons, cards, and layout.

`shouldProjectJingleToolActivity` replaces the renderer-local tool activity visibility policy from `src/renderer/src/lib/message-projection.ts`. The package owns loadExtension suppression, todo tool suppression, and callExtension presentation gating from minimal tool facts; the renderer file keeps Jingle todo-name and extension-presentation schema adapters.

`getJingleTurnPendingApproval`, `projectJingleTurnPendingApproval`, and `projectJingleTurnToolExecutionsView` replace renderer-local tool execution view and approval turn ownership policy from `src/renderer/src/lib/message-projection.ts`. The package reads minimal turn/tool/approval/result facts; the renderer file keeps Jingle `MessageTurn`, `HITLRequest`, and durable execution metadata adapters.

`projectJingleTurnElapsedDivider` replaces renderer-local elapsed divider timing projection from `src/renderer/src/lib/message-projection.ts`. The package reads active run start time and minimal tool result execution timing; the renderer file keeps `MessageTurn.toolResults` ownership.

`projectJingleRunCoachTip` and `projectJingleActiveTurnStatus` replace renderer-local run coach / active turn status policy from `src/renderer/src/lib/run-coach.ts` and `src/renderer/src/lib/message-projection.ts`. The old renderer `run-coach.ts` file has been removed; renderer code now adapts Jingle assistant entries and pending approval into minimal Jingle entry facts.

Later batches should move provider/client snapshot adapters, agent action hooks, and generic message projection helpers when the app/client store shape is ready.

Do not keep renderer-local duplicates after a migration batch lands.
