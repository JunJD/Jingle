import { createJingleToolRendererRegistry } from "@jingle/agent-react"
import type { ToolComponentDefinition } from "./types"

const toolRegistry = createJingleToolRendererRegistry<ToolComponentDefinition>()

export function defineToolComponent(definition: ToolComponentDefinition): ToolComponentDefinition {
  return toolRegistry.define(definition)
}

export function getToolComponent(name: string): ToolComponentDefinition | undefined {
  return toolRegistry.get(name)
}

export function registerToolComponent(definition: ToolComponentDefinition): () => void {
  return toolRegistry.register(definition)
}
