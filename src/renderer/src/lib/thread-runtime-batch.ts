import type { AgentThreadEvent, AgentThreadEventBatch } from "@shared/agent-thread-runtime"

export type RuntimeBatchSelection =
  | {
      type: "events"
      events: AgentThreadEvent[]
    }
  | {
      actualRevision: number
      expectedRevision: number
      type: "gap"
    }
  | {
      type: "none"
    }

export function selectRuntimeEventsAfterRevision(
  currentRevision: number,
  batch: AgentThreadEventBatch
): RuntimeBatchSelection {
  const events = batch.events.filter((event) => event.revision > currentRevision)
  if (events.length === 0) {
    if (batch.latestRevision > currentRevision) {
      return {
        actualRevision: batch.latestRevision,
        expectedRevision: currentRevision + 1,
        type: "gap"
      }
    }

    return { type: "none" }
  }

  let expectedRevision = currentRevision + 1
  for (const event of events) {
    if (event.revision !== expectedRevision) {
      return {
        actualRevision: event.revision,
        expectedRevision,
        type: "gap"
      }
    }

    expectedRevision += 1
  }

  const lastEventRevision = events[events.length - 1]?.revision ?? currentRevision
  if (batch.latestRevision > lastEventRevision) {
    return {
      actualRevision: batch.latestRevision,
      expectedRevision,
      type: "gap"
    }
  }

  return {
    events,
    type: "events"
  }
}
