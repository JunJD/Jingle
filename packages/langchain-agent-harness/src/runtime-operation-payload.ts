import { HumanMessage, RemoveMessage, type BaseMessage } from "@langchain/core/messages"
import { Command } from "@langchain/langgraph"
import type { RuntimeApproval } from "./runtime-state"
import {
  getJingleStandardContentResponseMetadata,
  JINGLE_COMPOSER_TEXT_METADATA_KEY,
  JINGLE_USER_MESSAGE_ADMISSION_METADATA_KEY
} from "./message-metadata"
import {
  type RuntimeToolApprovalDecision,
  type RuntimeToolApprovalDecisionType,
  type RuntimeInvokeInitialState
} from "./runtime-operation"
import type { RuntimeThreadInvokeInput, RuntimeThreadResumeInput } from "./runtime-thread"

export function buildRuntimeInvokeInitialState<TContextInclusion>(
  input: RuntimeThreadInvokeInput<TContextInclusion>
): RuntimeInvokeInitialState<TContextInclusion> {
  return {
    contextInclusions: input.contextInclusions,
    messages: buildRuntimeSubmittedMessages(input),
    ...(input.recordingRefs && input.recordingRefs.length > 0
      ? { recordingRefs: input.recordingRefs }
      : {}),
    ...(input.title ? { title: input.title } : {})
  }
}

export function buildRuntimeResumeCommand<TContextInclusion>(
  input: RuntimeThreadResumeInput<TContextInclusion>
): Command {
  const update = {
    approvals: [buildRuntimeResolvedApprovalFact(input.decision)],
    ...(input.contextInclusions && input.contextInclusions.length > 0
      ? { contextInclusions: input.contextInclusions }
      : {}),
    ...(input.recordingRefs && input.recordingRefs.length > 0
      ? { recordingRefs: input.recordingRefs }
      : {})
  }

  return new Command({
    resume: buildRuntimeResumeValue(input.decision),
    update
  })
}

function buildRuntimeSubmittedMessages<TContextInclusion>(
  input: RuntimeThreadInvokeInput<TContextInclusion>
): BaseMessage[] {
  const refs = input.message.refs ?? []
  const additionalKwargs = {
    ...(input.message.admission
      ? { [JINGLE_USER_MESSAGE_ADMISSION_METADATA_KEY]: input.message.admission }
      : {}),
    ...(typeof input.message.composerText === "string"
      ? { [JINGLE_COMPOSER_TEXT_METADATA_KEY]: input.message.composerText }
      : {}),
    ...(refs.length > 0 ? { refs } : {})
  }
  const responseMetadata = getJingleStandardContentResponseMetadata(input.message.content)
  const humanMessage = new HumanMessage({
    content: input.message.content,
    id: input.message.id,
    ...(Object.keys(additionalKwargs).length > 0 ? { additional_kwargs: additionalKwargs } : {}),
    ...(responseMetadata ? { response_metadata: responseMetadata } : {})
  })

  return [
    humanMessage,
    ...input.removeMessageIds.map((messageId) => new RemoveMessage({ id: messageId }))
  ]
}

function buildRuntimeResolvedApprovalFact(decision: RuntimeToolApprovalDecision): RuntimeApproval {
  const requestId = decision.request_id.trim()
  if (!requestId) {
    throw new Error("[RuntimeOperationPayload] Missing approval request_id.")
  }

  const base = {
    approvalId: requestId,
    requestId,
    toolCallId: decision.tool_call_id ?? null
  }
  if (decision.type === "corrected") {
    return { ...base, correction: decision.correction, status: "corrected" }
  }
  return {
    ...base,
    correction: null,
    status: decision.type === "approve" ? "approved" : "user_declined"
  }
}

function buildRuntimeResumeValue(decision: RuntimeToolApprovalDecision): {
  decisions: Array<{
    correction?: string
    type: RuntimeToolApprovalDecisionType
  }>
} {
  return {
    decisions: [
      {
        type: decision.type,
        ...(decision.type === "corrected" ? { correction: decision.correction } : {})
      }
    ]
  }
}
