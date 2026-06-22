import { HumanMessage, type BaseMessage } from "@langchain/core/messages"
import { createMiddleware } from "langchain"
import {
  extractMessageText,
  type AgentInvokeMessage,
  type ComposerMessageRef
} from "@shared/message-content"

export interface AppliedAgentSteer {
  acceptedAt: Date
  messageId: string
  runId: string | null
  text: string
}

interface PendingSteer {
  accepted: AppliedAgentSteer
  message: AgentInvokeMessage
}

interface AgentRunSteeringBufferOptions {
  onSteersApplied?: (steers: AppliedAgentSteer[]) => Promise<void> | void
}

export class AgentRunSteeringBuffer {
  private readonly pendingSteers: PendingSteer[] = []

  constructor(private readonly options: AgentRunSteeringBufferOptions = {}) {}

  accept(input: { message: AgentInvokeMessage; runId: string | null }): AppliedAgentSteer {
    const accepted: AppliedAgentSteer = {
      acceptedAt: new Date(),
      messageId: input.message.id,
      runId: input.runId,
      text: extractMessageText(input.message.content).trim()
    }
    this.pendingSteers.push({
      accepted,
      message: input.message
    })
    return accepted
  }

  async drainForModelCall(): Promise<PendingSteer[]> {
    const steers = this.pendingSteers.splice(0)
    if (steers.length > 0) {
      await this.options.onSteersApplied?.(steers.map((steer) => steer.accepted))
    }
    return steers
  }
}

function createSteeringHumanMessage(message: AgentInvokeMessage): BaseMessage {
  const refs = message.additional_kwargs?.refs as ComposerMessageRef[] | undefined
  return new HumanMessage({
    content: message.content,
    id: message.id,
    ...(refs && refs.length > 0 ? { additional_kwargs: { refs } } : {})
  })
}

export function createAgentRunSteeringBuffer(
  options?: AgentRunSteeringBufferOptions
): AgentRunSteeringBuffer {
  return new AgentRunSteeringBuffer(options)
}

export function createRunSteeringMiddleware(buffer: AgentRunSteeringBuffer) {
  return createMiddleware({
    name: "RunSteeringMiddleware",
    wrapModelCall: async (request, handler) => {
      if (!Array.isArray(request.messages)) {
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
