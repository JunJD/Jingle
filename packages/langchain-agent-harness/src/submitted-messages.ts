import {
  HumanMessage,
  RemoveMessage,
  type BaseMessage,
  type MessageContent
} from "@langchain/core/messages"
import type { RuntimeRecordingRef } from "./runtime-state"
import {
  getJingleStandardContentResponseMetadata,
  JINGLE_COMPOSER_TEXT_METADATA_KEY,
  JINGLE_USER_MESSAGE_ADMISSION_METADATA_KEY,
  type JingleUserMessageAdmissionIdentity
} from "./message-metadata"

export interface BuildJingleSubmittedMessagesInput {
  message: {
    admission?: JingleUserMessageAdmissionIdentity
    composerText?: string
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
