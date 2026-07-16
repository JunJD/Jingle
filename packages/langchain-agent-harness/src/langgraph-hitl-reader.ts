import type { CheckpointTuple } from "@langchain/langgraph-checkpoint"
import {
  buildJingleApprovalRequestFromInterruptValue,
  buildJingleApprovalRequestId,
  buildJinglePendingApprovalFact,
  getDefaultJingleApprovalAllowedDecisions,
  normalizeJingleApprovalAllowedDecisions,
  projectJingleApprovalInterruptWithRequestId,
  projectJinglePendingApprovalRequestFromValues,
  type JingleApprovalInterrupt,
  type JingleApprovalInterruptValue,
  type JingleApprovalRequest,
  type JingleApprovalReviewParser
} from "./approval-lifecycle"

export type JingleHitlDecisionType = "approve" | "user_declined" | "corrected"

export type JingleHitlToolCall = JingleApprovalRequest["tool_call"]
export type JingleHitlRequest<TReview = unknown> = JingleApprovalRequest<TReview>

export interface JinglePendingHitlRequestContext {
  runId: string | null
  threadId: string
}

export type JinglePendingHitlRequestUpserter<TReview = unknown> = (
  request: JingleHitlRequest<TReview>,
  context: JinglePendingHitlRequestContext
) => Promise<void> | void

export type JingleLangGraphInterrupt = JingleApprovalInterrupt

export type JingleHitlReviewParser<TReview = unknown> = JingleApprovalReviewParser<TReview>

export type JingleCheckpointRunStatus = "interrupted" | "success"

export interface PersistJingleValuesHitlRequestInput<TReview = unknown> {
  data: unknown
  mode: string
  parseReview: JingleHitlReviewParser<TReview>
  runId: string
  threadId: string
  upsertPendingHitlRequest: JinglePendingHitlRequestUpserter<TReview>
}

type CheckpointInterruptValue = JingleApprovalInterruptValue

interface LatestCheckpointState {
  checkpoint?: {
    id?: string
    channel_values?: {
      __interrupt__?: Array<{
        value?: CheckpointInterruptValue
      }>
    }
  }
}

interface ValuesRuntimeState {
  __interrupt__?: Array<JingleLangGraphInterrupt & { value?: CheckpointInterruptValue }>
}

export function getDefaultJingleHitlAllowedDecisions(): JingleHitlDecisionType[] {
  return getDefaultJingleApprovalAllowedDecisions()
}

export function normalizeJingleHitlAllowedDecisions(value: unknown): JingleHitlDecisionType[] {
  return normalizeJingleApprovalAllowedDecisions(value)
}

export function buildJingleHitlRequestId(
  threadId: string,
  requestContextId: string,
  toolCallId: string
): string {
  return buildJingleApprovalRequestId({
    requestContextId,
    threadId,
    toolCallId
  })
}

export const projectJinglePendingApprovalFromHitlRequest = buildJinglePendingApprovalFact

function buildHitlRequestFromInterruptValue<TReview>(input: {
  interruptValue?: CheckpointInterruptValue
  parseReview: JingleHitlReviewParser<TReview>
  requestContextId: string
  threadId: string
}): JingleHitlRequest<TReview> | null {
  return buildJingleApprovalRequestFromInterruptValue(input)
}

export function checkpointHasJingleHitlInterrupt(tuple: CheckpointTuple | undefined): boolean {
  const state = tuple as LatestCheckpointState | undefined
  const interrupts = state?.checkpoint?.channel_values?.__interrupt__
  return Array.isArray(interrupts) && interrupts.length > 0
}

export function resolveJingleCheckpointRunStatus(
  tuple: CheckpointTuple | undefined
): JingleCheckpointRunStatus {
  return checkpointHasJingleHitlInterrupt(tuple) ? "interrupted" : "success"
}

export function extractJingleHitlRequestFromCheckpoint<TReview>(
  threadId: string,
  tuple: CheckpointTuple | undefined,
  input: {
    parseReview: JingleHitlReviewParser<TReview>
    runId?: string | null
  }
): JingleHitlRequest<TReview> | null {
  const state = tuple as LatestCheckpointState | undefined
  const tupleRunId =
    typeof tuple?.config?.configurable?.run_id === "string"
      ? tuple.config.configurable.run_id
      : null
  const interruptValue = state?.checkpoint?.channel_values?.__interrupt__?.[0]?.value
  const checkpointId = state?.checkpoint?.id || "latest"
  const requestContextId = input.runId || tupleRunId || checkpointId

  return buildHitlRequestFromInterruptValue({
    interruptValue,
    parseReview: input.parseReview,
    requestContextId,
    threadId
  })
}

export function extractJingleHitlRequestFromValuesState<TReview>(
  threadId: string,
  runId: string,
  data: unknown,
  input: {
    parseReview: JingleHitlReviewParser<TReview>
  }
): JingleHitlRequest<TReview> | null {
  return projectJinglePendingApprovalRequestFromValues({
    data,
    parseReview: input.parseReview,
    runId,
    threadId
  })
}

export async function persistJingleValuesHitlRequest<TReview>(
  input: PersistJingleValuesHitlRequestInput<TReview>
): Promise<boolean> {
  if (input.mode !== "values") {
    return false
  }

  const request = extractJingleHitlRequestFromValuesState(input.threadId, input.runId, input.data, {
    parseReview: input.parseReview
  })
  if (!request) {
    return false
  }

  await input.upsertPendingHitlRequest(request, {
    runId: input.runId,
    threadId: input.threadId
  })
  return true
}

export function projectJingleValuesInterruptWithRequestIds(
  threadId: string,
  runId: string,
  data: unknown
): JingleLangGraphInterrupt[] | undefined {
  const state = data as ValuesRuntimeState | undefined
  if (!Array.isArray(state?.__interrupt__)) {
    return undefined
  }

  const request = extractJingleHitlRequestFromValuesState(threadId, runId, data, {
    parseReview: () => null
  })
  if (!request) {
    return state.__interrupt__
  }

  return projectJingleApprovalInterruptWithRequestId({
    interrupts: state.__interrupt__,
    request
  })
}
