import type { Subagent } from "@shared/app-types"

interface AccumulatedToolCall {
  args: string
  id: string
  name: string
}

export class TaskToolCallTracker {
  private readonly accumulatedToolCalls = new Map<string, AccumulatedToolCall>()
  private readonly activeSubagents = new Map<string, Subagent>()

  completeSubagent(toolCallId: string): Subagent[] | null {
    const subagent = this.activeSubagents.get(toolCallId)
    if (!subagent) {
      return null
    }

    subagent.completedAt = new Date()
    subagent.status = "completed"
    return Array.from(this.activeSubagents.values())
  }

  readSubagentsFromCompletedToolCalls(
    toolCalls: Array<{ args?: Record<string, unknown>; id?: string; name?: string }>
  ): Subagent[] | null {
    let changed = false

    for (const toolCall of toolCalls) {
      if (!toolCall.id || !toolCall.name) {
        continue
      }

      if (toolCall.name !== "task" || this.activeSubagents.has(toolCall.id)) {
        continue
      }

      const args = toolCall.args || {}
      if (!args.subagent_type && !args.description) {
        continue
      }

      this.activeSubagents.set(toolCall.id, this.createSubagentFromTask(toolCall.id, args))
      changed = true
    }

    return changed ? Array.from(this.activeSubagents.values()) : null
  }

  readSubagentsFromToolCallChunks(
    chunks: Array<{ args?: string; id?: string; name?: string }>
  ): Subagent[] | null {
    let changed = false

    for (const chunk of chunks) {
      if (!chunk.id) {
        continue
      }

      let accumulated = this.accumulatedToolCalls.get(chunk.id)
      if (!accumulated) {
        accumulated = { args: "", id: chunk.id, name: chunk.name || "" }
        this.accumulatedToolCalls.set(chunk.id, accumulated)
      }

      if (chunk.name) {
        accumulated.name = chunk.name
      }

      if (chunk.args) {
        accumulated.args += chunk.args
      }

      if (accumulated.name !== "task" || this.activeSubagents.has(chunk.id)) {
        continue
      }

      try {
        const parsedArgs = JSON.parse(accumulated.args) as Record<string, unknown>
        if (!parsedArgs.subagent_type) {
          continue
        }

        this.activeSubagents.set(chunk.id, this.createSubagentFromTask(chunk.id, parsedArgs))
        changed = true
      } catch {
        continue
      }
    }

    return changed ? Array.from(this.activeSubagents.values()) : null
  }

  reset(): void {
    this.accumulatedToolCalls.clear()
    this.activeSubagents.clear()
  }

  private createSubagentFromTask(toolCallId: string, args: Record<string, unknown>): Subagent {
    const subagentType = (args.subagent_type as string) || "general-purpose"
    const description = (args.description as string) || "Executing task..."
    const nameMap: Record<string, string> = {
      "code-reviewer": "Code Reviewer",
      "correctness-checker": "Correctness Checker",
      "final-reviewer": "Final Reviewer",
      "general-purpose": "General Purpose Agent",
      research: "Research Agent"
    }

    return {
      description,
      id: toolCallId,
      name: nameMap[subagentType] || this.formatSubagentName(subagentType),
      startedAt: new Date(),
      status: "running",
      subagentType,
      toolCallId
    }
  }

  private formatSubagentName(subagentType: string): string {
    return subagentType
      .split("-")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ")
  }
}
