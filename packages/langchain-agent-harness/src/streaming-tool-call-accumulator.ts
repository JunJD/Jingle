import type { JingleLangGraphToolCallChunk } from "./langgraph-stream-reader"

export interface JingleStreamingToolCall {
  argsText: string
  id: string
  index: number | null
  messageId: string | null
  name: string
  runId: string | null
  startedAt: Date
  status: "arguments_streaming"
}

function mergeJingleToolCallName(existingName: string, incomingName: string | undefined): string {
  if (!incomingName) {
    return existingName
  }

  if (!existingName || incomingName.startsWith(existingName)) {
    return incomingName
  }

  if (existingName === incomingName || existingName.endsWith(incomingName)) {
    return existingName
  }

  return `${existingName}${incomingName}`
}

export class JingleStreamingToolCallAccumulator {
  private toolCalls: JingleStreamingToolCall[] = []

  reset(): void {
    this.toolCalls = []
  }

  update(input: {
    chunks: readonly JingleLangGraphToolCallChunk[]
    messageId: string
    runId: string | null
  }): JingleStreamingToolCall[] {
    const updatedToolCalls: JingleStreamingToolCall[] = []

    for (const chunk of input.chunks) {
      const index = chunk.index ?? null
      if (!chunk.id && index === null) {
        continue
      }

      const existingIndex = this.toolCalls.findIndex((toolCall) => {
        if (chunk.id && toolCall.id === chunk.id) {
          return true
        }

        return (
          toolCall.messageId === input.messageId &&
          toolCall.index !== null &&
          index !== null &&
          toolCall.index === index
        )
      })
      const existingToolCall = existingIndex >= 0 ? this.toolCalls[existingIndex] : null
      const id = chunk.id ?? existingToolCall?.id ?? `${input.messageId}:tool:${index}`
      const toolCall: JingleStreamingToolCall = {
        argsText: `${existingToolCall?.argsText ?? ""}${chunk.args ?? ""}`,
        id,
        index,
        messageId: input.messageId,
        name: mergeJingleToolCallName(existingToolCall?.name ?? "", chunk.name),
        runId: input.runId,
        startedAt: existingToolCall?.startedAt ?? new Date(),
        status: "arguments_streaming"
      }

      if (existingIndex >= 0) {
        this.toolCalls[existingIndex] = toolCall
      } else {
        this.toolCalls.push(toolCall)
      }

      updatedToolCalls.push(toolCall)
    }

    return updatedToolCalls
  }

  readToolCall(id: string): JingleStreamingToolCall | null {
    return this.toolCalls.find((toolCall) => toolCall.id === id) ?? null
  }
}
