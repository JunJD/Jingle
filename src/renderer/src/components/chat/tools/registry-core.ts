import type { ToolComponentDefinition } from "./types"

const toolRegistry = new Map<string, ToolComponentDefinition>()

export function defineToolComponent(definition: ToolComponentDefinition): ToolComponentDefinition {
  toolRegistry.set(definition.name, definition)
  return definition
}

export function getToolComponent(name: string): ToolComponentDefinition | undefined {
  return toolRegistry.get(name)
}
