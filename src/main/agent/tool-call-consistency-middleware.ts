import { AIMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages"
import { createMiddleware } from "langchain"

function getToolCallIds(message: AIMessage): Set<string> {
  return new Set(
    (message.tool_calls ?? [])
      .map((toolCall) => toolCall.id)
      .filter((id): id is string => typeof id === "string" && id.length > 0)
  )
}

export function removeOrphanedToolMessages(messages: BaseMessage[]): BaseMessage[] {
  const validToolCallIds = new Set<string>()
  let changed = false
  const nextMessages: BaseMessage[] = []

  for (const message of messages) {
    if (AIMessage.isInstance(message)) {
      for (const toolCallId of getToolCallIds(message)) {
        validToolCallIds.add(toolCallId)
      }
      nextMessages.push(message)
      continue
    }

    if (ToolMessage.isInstance(message)) {
      if (validToolCallIds.has(message.tool_call_id)) {
        nextMessages.push(message)
      } else {
        changed = true
      }
      continue
    }

    nextMessages.push(message)
  }

  return changed ? nextMessages : messages
}

export function createToolCallConsistencyMiddleware() {
  return createMiddleware({
    name: "ToolCallConsistencyMiddleware",
    wrapModelCall: async (request, handler) => {
      const messages = Array.isArray(request.messages)
        ? removeOrphanedToolMessages(request.messages)
        : request.messages

      return handler(
        messages === request.messages
          ? request
          : {
              ...request,
              messages
            }
      )
    }
  })
}
