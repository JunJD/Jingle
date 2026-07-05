import type { CheckpointTuple } from "@langchain/langgraph-checkpoint"
import {
  readJingleLangGraphCheckpointMessages,
  type JingleLangGraphCheckpointMessage
} from "./langgraph-checkpoint-reader"

export interface JingleLangGraphCheckpointProjectedMessage {
  content: string
  created_at: number
  kind: string
  message_id: string
  metadata?: string | null
  name?: string | null
  role: string
  tool_call_id?: string | null
  tool_calls?: string | null
}

export interface ProjectJingleLangGraphCheckpointMessagesInput {
  now?: number
  threadId: string
  toAssistantDisplayContent: (
    content: string | unknown[],
    message: JingleLangGraphCheckpointMessage
  ) => unknown
  toMessageMetadata: (
    message: JingleLangGraphCheckpointMessage
  ) => Record<string, unknown> | null
  tuple: CheckpointTuple | undefined
}

function getCheckpointProjectedMessageId(input: {
  message: JingleLangGraphCheckpointMessage
  role: string
  threadId: string
}): string {
  if (input.message.kwargsId && input.message.kwargsId.length > 0) {
    return input.message.kwargsId
  }

  if (input.message.topLevelId && input.message.topLevelId.length > 0) {
    return input.message.topLevelId
  }

  if (input.message.topLevelToolCallId && input.message.topLevelToolCallId.length > 0) {
    return input.message.topLevelToolCallId
  }

  if (input.message.toolCallId && input.message.toolCallId.length > 0) {
    return input.message.toolCallId
  }

  return `checkpoint:${input.threadId}:${input.message.index}:${input.role}`
}

export function projectJingleLangGraphCheckpointMessages(
  input: ProjectJingleLangGraphCheckpointMessagesInput
): JingleLangGraphCheckpointProjectedMessage[] {
  const messages = readJingleLangGraphCheckpointMessages(input.tuple)
  if (!messages) {
    return []
  }

  const now = input.now ?? Date.now()

  return messages.map((message, index) => {
    const role = message.role
    const content =
      role === "assistant"
        ? input.toAssistantDisplayContent(message.content, message)
        : message.content
    const messageMetadata = input.toMessageMetadata(message)

    return {
      message_id: getCheckpointProjectedMessageId({
        message,
        role,
        threadId: input.threadId
      }),
      role,
      kind: role === "tool" ? "tool_result" : "message",
      content: JSON.stringify(content),
      tool_calls: message.toolCalls.length > 0 ? JSON.stringify(message.toolCalls) : null,
      tool_call_id: message.toolCallId ?? message.topLevelToolCallId ?? null,
      name: message.name ?? null,
      metadata: messageMetadata ? JSON.stringify(messageMetadata) : null,
      created_at: now + index
    }
  })
}
