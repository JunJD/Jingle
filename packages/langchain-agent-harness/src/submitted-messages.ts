import {
  HumanMessage,
  RemoveMessage,
  type BaseMessage,
  type MessageContent
} from "@langchain/core/messages"
import type { RuntimeRecordingRef } from "./runtime-state"

export interface BuildJingleSubmittedMessagesInput {
  message: {
    content: MessageContent
    id: string
    refs?: unknown[]
  }
  removeMessageIds: string[]
}

export interface JingleInvokeInitialState<TContextInclusion = unknown> {
  contextInclusions: TContextInclusion[]
  messages: BaseMessage[]
  recordingRefs?: RuntimeRecordingRef[]
  title?: string
}

export interface BuildJingleInvokeInitialStateInput<TContextInclusion = unknown> {
  contextInclusions: TContextInclusion[]
  messages: BaseMessage[]
  recordingRefs?: RuntimeRecordingRef[]
  title?: string | null
}

export function buildJingleSubmittedMessages(
  input: BuildJingleSubmittedMessagesInput
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

export function buildJingleInvokeInitialState<TContextInclusion>(
  input: BuildJingleInvokeInitialStateInput<TContextInclusion>
): JingleInvokeInitialState<TContextInclusion> {
  return {
    contextInclusions: input.contextInclusions,
    messages: input.messages,
    ...(input.recordingRefs && input.recordingRefs.length > 0
      ? { recordingRefs: input.recordingRefs }
      : {}),
    ...(input.title ? { title: input.title } : {})
  }
}
