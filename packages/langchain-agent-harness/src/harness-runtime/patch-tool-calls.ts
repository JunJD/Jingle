import { AIMessage, RemoveMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages"
import { REMOVE_ALL_MESSAGES } from "@langchain/langgraph"
import { createMiddleware, type AgentMiddleware } from "langchain"

export interface JinglePatchDanglingToolCallsResult {
  needsPatch: boolean
  patchedMessages: BaseMessage[]
}

export function patchJingleDanglingToolCalls(
  messages: readonly BaseMessage[] | null | undefined
): JinglePatchDanglingToolCallsResult {
  if (!messages || messages.length === 0) {
    return {
      needsPatch: false,
      patchedMessages: []
    }
  }

  const patchedMessages: BaseMessage[] = []
  let needsPatch = false
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index]
    patchedMessages.push(message)

    if (!AIMessage.isInstance(message) || message.tool_calls == null) {
      continue
    }

    for (const toolCall of message.tool_calls) {
      if (!toolCall.id) {
        continue
      }

      const hasToolMessage = messages
        .slice(index)
        .some(
          (candidate) =>
            ToolMessage.isInstance(candidate) && candidate.tool_call_id === toolCall.id
        )
      if (hasToolMessage) {
        continue
      }

      needsPatch = true
      patchedMessages.push(
        new ToolMessage({
          content: `Tool call ${toolCall.name} with id ${toolCall.id} was cancelled - another message came in before it could be completed.`,
          name: toolCall.name,
          tool_call_id: toolCall.id
        })
      )
    }
  }

  return {
    needsPatch,
    patchedMessages
  }
}

export function createJinglePatchToolCallsMiddleware(): AgentMiddleware {
  return createMiddleware({
    name: "patchToolCallsMiddleware",
    beforeAgent: async (state) => {
      const messages = (state as { messages?: BaseMessage[] }).messages
      const { needsPatch, patchedMessages } = patchJingleDanglingToolCalls(messages)
      if (!needsPatch) {
        return undefined
      }

      return {
        messages: [new RemoveMessage({ id: REMOVE_ALL_MESSAGES }), ...patchedMessages]
      }
    },
    wrapModelCall: async (request, handler) => {
      const { needsPatch, patchedMessages } = patchJingleDanglingToolCalls(request.messages)
      if (!needsPatch) {
        return handler(request)
      }

      return handler({
        ...request,
        messages: patchedMessages
      })
    }
  })
}
