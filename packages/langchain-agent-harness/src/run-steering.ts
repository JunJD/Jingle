import {
  AIMessage,
  HumanMessage,
  ToolMessage,
  type BaseMessage,
  type MessageContent
} from "@langchain/core/messages"
import { createMiddleware } from "langchain"

export interface AppliedAgentSteer<
  TContent extends MessageContent = MessageContent,
  TRefs extends readonly unknown[] = readonly unknown[]
> {
  acceptedAt: Date
  content: TContent
  messageId: string
  refs?: TRefs
  runId: string | null
  text: string
}

export interface AgentRunSteerMessage<
  TContent extends MessageContent = MessageContent,
  TRefs extends readonly unknown[] = readonly unknown[]
> {
  content: TContent
  id: string
  refs?: TRefs
  text: string
}

export interface AgentRunPendingSteer<
  TContent extends MessageContent = MessageContent,
  TRefs extends readonly unknown[] = readonly unknown[]
> {
  accepted: AppliedAgentSteer<TContent, TRefs>
  message: AgentRunSteerMessage<TContent, TRefs>
}

export interface AgentRunSteeringBufferPort {
  drainForModelCall: () => Promise<AgentRunPendingSteer[]>
  hasPending: () => boolean
}

export interface AgentRunSteeringBufferOptions<
  TContent extends MessageContent = MessageContent,
  TRefs extends readonly unknown[] = readonly unknown[]
> {
  onSteersApplied?: (steers: AppliedAgentSteer<TContent, TRefs>[]) => Promise<void> | void
}

export class AgentRunSteeringBuffer<
  TContent extends MessageContent = MessageContent,
  TRefs extends readonly unknown[] = readonly unknown[]
> {
  private readonly pendingSteers: AgentRunPendingSteer<TContent, TRefs>[] = []

  constructor(private readonly options: AgentRunSteeringBufferOptions<TContent, TRefs> = {}) {}

  accept(input: {
    acceptedAt?: Date
    message: AgentRunSteerMessage<TContent, TRefs>
    runId: string | null
  }): AppliedAgentSteer<TContent, TRefs> {
    const accepted: AppliedAgentSteer<TContent, TRefs> = {
      acceptedAt: input.acceptedAt ?? new Date(),
      content: input.message.content,
      messageId: input.message.id,
      ...(input.message.refs && input.message.refs.length > 0 ? { refs: input.message.refs } : {}),
      runId: input.runId,
      text: input.message.text
    }
    this.pendingSteers.push({
      accepted,
      message: input.message
    })
    return accepted
  }

  hasPending(): boolean {
    return this.pendingSteers.length > 0
  }

  async drainForModelCall(): Promise<AgentRunPendingSteer<TContent, TRefs>[]> {
    const steers = this.pendingSteers.splice(0)
    if (steers.length > 0) {
      await this.options.onSteersApplied?.(steers.map((steer) => steer.accepted))
    }
    return steers
  }
}

function createSteeringHumanMessage(message: AgentRunSteerMessage): BaseMessage {
  const refs = message.refs
  return new HumanMessage({
    content: message.content,
    id: message.id,
    ...(refs && refs.length > 0 ? { additional_kwargs: { refs } } : {})
  })
}

function shouldContinueForPendingSteers(
  buffer: Pick<AgentRunSteeringBufferPort, "hasPending">,
  messages: readonly unknown[] | undefined
): boolean {
  if (!buffer.hasPending()) {
    return false
  }

  return !hasPendingToolCalls(messages)
}

function hasPendingToolCalls(messages: readonly unknown[] | undefined): boolean {
  if (!messages) {
    return false
  }

  let latestAiMessage: AIMessage | null = null
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (AIMessage.isInstance(message)) {
      latestAiMessage = message
      break
    }
  }

  const toolCalls = latestAiMessage?.tool_calls ?? []
  if (toolCalls.length === 0) {
    return false
  }

  const completedToolCallIds = new Set(
    messages
      .filter((message) => ToolMessage.isInstance(message))
      .map((message) => message.tool_call_id)
  )

  return toolCalls.some((toolCall) => !toolCall.id || !completedToolCallIds.has(toolCall.id))
}

export function createAgentRunSteeringBuffer(
  options?: AgentRunSteeringBufferOptions
): AgentRunSteeringBuffer
export function createAgentRunSteeringBuffer<
  TContent extends MessageContent,
  TRefs extends readonly unknown[]
>(options?: AgentRunSteeringBufferOptions<TContent, TRefs>): AgentRunSteeringBuffer<TContent, TRefs>
export function createAgentRunSteeringBuffer<
  TContent extends MessageContent,
  TRefs extends readonly unknown[]
>(
  options?: AgentRunSteeringBufferOptions<TContent, TRefs>
): AgentRunSteeringBuffer<TContent, TRefs> {
  return new AgentRunSteeringBuffer(options)
}

export function createRunSteeringMiddleware<
  TContent extends MessageContent,
  TRefs extends readonly unknown[]
>(buffer: AgentRunSteeringBuffer<TContent, TRefs>): ReturnType<typeof createMiddleware>
export function createRunSteeringMiddleware(
  buffer: AgentRunSteeringBufferPort
): ReturnType<typeof createMiddleware>
export function createRunSteeringMiddleware(
  buffer: AgentRunSteeringBufferPort
): ReturnType<typeof createMiddleware> {
  return createMiddleware({
    name: "RunSteeringMiddleware",
    afterModel: {
      canJumpTo: ["model"],
      hook: (state) => {
        if (!shouldContinueForPendingSteers(buffer, state.messages)) {
          return
        }

        return {
          jumpTo: "model" as const
        }
      }
    },
    afterAgent: {
      canJumpTo: ["model"],
      hook: (state) => {
        // Final answers leave the afterModel router before honoring jumpTo.
        if (!shouldContinueForPendingSteers(buffer, state.messages)) {
          return
        }

        return {
          jumpTo: "model" as const
        }
      }
    },
    wrapModelCall: async (request, handler) => {
      if (!Array.isArray(request.messages)) {
        return handler(request)
      }

      if (hasPendingToolCalls(request.messages)) {
        return handler(request)
      }

      const steers = await buffer.drainForModelCall()
      if (steers.length === 0) {
        return handler(request)
      }

      return handler({
        ...request,
        messages: [
          ...request.messages,
          ...steers.map((steer) => createSteeringHumanMessage(steer.message))
        ]
      })
    }
  })
}
