export interface AiToolDefinition {
  description?: string
  name: string
  run: (input: unknown) => Promise<unknown> | unknown
  title?: string
}

export interface RegisteredAiTool extends AiToolDefinition {
  ownerId: string
}

const toolsByOwner = new Map<string, Map<string, AiToolDefinition>>()

function getOwnerToolMap(ownerId: string): Map<string, AiToolDefinition> {
  const existing = toolsByOwner.get(ownerId)
  if (existing) {
    return existing
  }

  const next = new Map<string, AiToolDefinition>()
  toolsByOwner.set(ownerId, next)
  return next
}

export function registerAiTools(ownerId: string, tools: readonly AiToolDefinition[]): () => void {
  const ownerTools = getOwnerToolMap(ownerId)
  const registeredToolNames: string[] = []

  for (const tool of tools) {
    if (ownerTools.has(tool.name)) {
      throw new Error(`AI tool "${ownerId}:${tool.name}" is already registered`)
    }

    ownerTools.set(tool.name, tool)
    registeredToolNames.push(tool.name)
  }

  return () => {
    const currentOwnerTools = toolsByOwner.get(ownerId)
    if (!currentOwnerTools) {
      return
    }

    for (const toolName of registeredToolNames) {
      currentOwnerTools.delete(toolName)
    }

    if (currentOwnerTools.size === 0) {
      toolsByOwner.delete(ownerId)
    }
  }
}

export function listRegisteredAiTools(): RegisteredAiTool[] {
  return Array.from(toolsByOwner.entries()).flatMap(([ownerId, tools]) =>
    Array.from(tools.values()).map((tool) => ({
      ...tool,
      ownerId
    }))
  )
}
