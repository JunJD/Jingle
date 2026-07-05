
import { AIMessage, ToolMessage } from "@langchain/core/messages"
import { END, Send } from "@langchain/langgraph"
import {
  LEGACY_TOOLS_NODE_NAME,
  parseRuntimeJumpTarget,
  type RuntimeDestinationMappingInput
} from "./legacy-destination-compat.js"

export interface RuntimeStepResultRouterInput extends RuntimeDestinationMappingInput {
  readonly allowLegacyAfterModelJump: boolean
  readonly hasStructuredResponse: boolean
  readonly hasToolsAvailable: boolean
}

export function createRuntimeStepResultRouter(input: RuntimeStepResultRouterInput) {
  return (state: any) => {
    if (state._runtimeStepRoute === "pause" || state._runtimeStepRoute === "error") {
      return input.exitNode
    }
    if (state._runtimeStepRoute === "finish") return input.exitNode

    const messages = state.messages
    const lastMessage = messages.at(-1)
    if (
      AIMessage.isInstance(lastMessage) &&
      (!lastMessage.tool_calls || lastMessage.tool_calls.length === 0)
    ) {
      return input.exitNode
    }

    if (input.allowLegacyAfterModelJump && state.jumpTo) {
      const destination = parseRuntimeJumpTarget(state.jumpTo)
      if (destination === END) return input.exitNode
      if (destination === LEGACY_TOOLS_NODE_NAME) {
        if (!input.hasToolsAvailable) return input.exitNode
        return new Send(input.permissionGateNode, {
          ...state,
          jumpTo: undefined
        })
      }
      return new Send(input.modelEntryNode, {
        ...state,
        jumpTo: undefined
      })
    }

    const toolMessages = messages.filter(ToolMessage.isInstance)
    const lastAiMessage = messages.filter(AIMessage.isInstance).at(-1)
    const pendingToolCalls = lastAiMessage?.tool_calls?.filter(
      (call) => !toolMessages.some((message) => message.tool_call_id === call.id)
    )
    if (pendingToolCalls && pendingToolCalls.length > 0) {
      if (!input.hasToolsAvailable) return input.exitNode
      return pendingToolCalls.map(
        (toolCall) =>
          new Send(input.permissionGateNode, {
            ...state,
            lg_tool_call: toolCall
          })
      )
    }

    const hasStructuredResponseCalls = lastAiMessage?.tool_calls?.some((toolCall) =>
      toolCall.name.startsWith("extract-")
    )
    if (
      pendingToolCalls &&
      pendingToolCalls.length === 0 &&
      !hasStructuredResponseCalls &&
      input.hasStructuredResponse
    ) {
      return input.modelEntryNode
    }

    if (
      !AIMessage.isInstance(lastMessage) ||
      !lastMessage.tool_calls ||
      lastMessage.tool_calls.length === 0
    ) {
      return input.exitNode
    }

    const hasOnlyStructuredResponseCalls = lastMessage.tool_calls.every((toolCall) =>
      toolCall.name.startsWith("extract-")
    )
    const hasRegularToolCalls = lastMessage.tool_calls.some(
      (toolCall) => !toolCall.name.startsWith("extract-")
    )
    if (hasOnlyStructuredResponseCalls || !hasRegularToolCalls) return input.exitNode

    const regularToolCalls = lastMessage.tool_calls.filter(
      (toolCall) => !toolCall.name.startsWith("extract-")
    )
    if (regularToolCalls.length === 0) return input.exitNode
    if (!input.hasToolsAvailable) return input.exitNode
    return regularToolCalls.map(
      (toolCall) =>
        new Send(input.permissionGateNode, {
          ...state,
          lg_tool_call: toolCall
        })
    )
  }
}
