import type { RuntimeRecordingRef } from "./runtime-state"

export function createJingleAgentTraceRecordingRef(input: {
  createdAt: string
  runId: string
  threadId: string
}): RuntimeRecordingRef {
  return {
    createdAt: input.createdAt,
    domain: "agent_trace",
    path: null,
    refId: input.runId,
    runId: input.runId,
    threadId: input.threadId
  }
}
