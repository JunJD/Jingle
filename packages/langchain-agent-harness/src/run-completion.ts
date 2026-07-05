import type { RuntimeRecordingRef } from "./runtime-state"

export type JingleRunCompletionStatus = "interrupted" | "success"

export interface JingleRunCompletionFacts<TContextInclusion = unknown> {
  contextInclusions: TContextInclusion[]
  recordingRefs: RuntimeRecordingRef[]
}

export interface CompleteJingleAgentRunInput<TContextInclusion = unknown> {
  expectedMessageId?: string
  interrupted: boolean
  recordRunFinished: (event: {
    runId: string
    status: JingleRunCompletionStatus
    threadId: string
  }) => Promise<void> | void
  recordRunInterrupted: (event: {
    runId: string
    status: "interrupted"
    threadId: string
  }) => Promise<void> | void
  runId: string
  threadId: string
  useCheckpointPersistence: boolean
  finalizeRunWithoutCheckpoint: (input: {
    interrupted: boolean
    runId: string
    threadId: string
  }) => Promise<JingleRunCompletionFacts<TContextInclusion>> | JingleRunCompletionFacts<TContextInclusion>
  syncRunFromLatestCheckpoint: (input: {
    expectedMessageId?: string
    interrupted: boolean
    runId: string
    threadId: string
  }) => Promise<JingleRunCompletionFacts<TContextInclusion>> | JingleRunCompletionFacts<TContextInclusion>
}

export interface AbortJingleAgentRunInput {
  markRunAborted: (input: { runId: string; threadId: string }) => Promise<void> | void
  recordRunFinished: (event: {
    completionReason: "aborted"
    runId: string
    status: "interrupted"
    threadId: string
  }) => Promise<void> | void
  recordRunInterrupted: (event: {
    runId: string
    status: "interrupted"
    threadId: string
  }) => Promise<void> | void
  runId: string
  threadId: string
}

export interface FailJingleAgentRunInput<TError = unknown> {
  error: TError
  markRunFailed: (input: { error: TError; runId: string; threadId: string }) => Promise<void> | void
  recordRunFinished: (event: {
    error: TError
    runId: string
    status: "error"
    threadId: string
  }) => Promise<void> | void
  runId: string
  threadId: string
}

export interface CompleteJingleAgentRunResult<TContextInclusion = unknown> {
  facts: JingleRunCompletionFacts<TContextInclusion>
  status: JingleRunCompletionStatus
}

export async function completeJingleAgentRun<TContextInclusion>(
  input: CompleteJingleAgentRunInput<TContextInclusion>
): Promise<CompleteJingleAgentRunResult<TContextInclusion>> {
  let facts: JingleRunCompletionFacts<TContextInclusion>
  if (input.useCheckpointPersistence) {
    facts = await input.syncRunFromLatestCheckpoint({
      expectedMessageId: input.expectedMessageId,
      interrupted: input.interrupted,
      runId: input.runId,
      threadId: input.threadId
    })
  } else {
    facts = await input.finalizeRunWithoutCheckpoint({
      interrupted: input.interrupted,
      runId: input.runId,
      threadId: input.threadId
    })
  }

  const status = input.interrupted ? "interrupted" : "success"
  if (input.interrupted) {
    await input.recordRunInterrupted({
      runId: input.runId,
      status: "interrupted",
      threadId: input.threadId
    })
  }

  await input.recordRunFinished({
    runId: input.runId,
    status,
    threadId: input.threadId
  })

  return {
    facts,
    status
  }
}

export async function abortJingleAgentRun(input: AbortJingleAgentRunInput): Promise<void> {
  await input.markRunAborted({
    runId: input.runId,
    threadId: input.threadId
  })
  await input.recordRunInterrupted({
    runId: input.runId,
    status: "interrupted",
    threadId: input.threadId
  })
  await input.recordRunFinished({
    completionReason: "aborted",
    runId: input.runId,
    status: "interrupted",
    threadId: input.threadId
  })
}

export async function failJingleAgentRun<TError>(
  input: FailJingleAgentRunInput<TError>
): Promise<void> {
  await input.markRunFailed({
    error: input.error,
    runId: input.runId,
    threadId: input.threadId
  })
  await input.recordRunFinished({
    error: input.error,
    runId: input.runId,
    status: "error",
    threadId: input.threadId
  })
}
