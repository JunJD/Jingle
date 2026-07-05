import {
  HumanMessage,
  RemoveMessage,
  type BaseMessage
} from "@langchain/core/messages"
import { Command } from "@langchain/langgraph"
import type { RuntimeApproval } from "./runtime-state"
import {
  type RuntimeToolApprovalDecision,
  type RuntimeToolApprovalDecisionType,
  type RuntimeInvokeInitialState
} from "./runtime-operation"
import type {
  RuntimeThreadInvokeInput,
  RuntimeThreadResumeInput
} from "./runtime-thread"

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
  const humanMessage = new HumanMessage({
    content: input.message.content,
    id: input.message.id,
    ...(refs.length > 0 ? { additional_kwargs: { refs } } : {})
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

  return {
    approvalId: requestId,
    requestId,
    status: decision.type === "approve" ? "approved" : "rejected",
    toolCallId: decision.tool_call_id ?? null
  }
}

function buildRuntimeResumeValue(decision: RuntimeToolApprovalDecision): {
  decisions: Array<{
    feedback?: string
    type: RuntimeToolApprovalDecisionType
  }>
} {
  return {
    decisions: [
      {
        type: decision.type,
        ...(decision.feedback ? { feedback: decision.feedback } : {})
      }
    ]
  }
}
