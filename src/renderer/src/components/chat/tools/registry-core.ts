import type { HumanInTheLoopDefinition, ToolComponentDefinition } from "./types"

const toolRegistry = new Map<string, ToolComponentDefinition>()
const hitlRegistry = new Map<string, HumanInTheLoopDefinition>()

export function defineToolComponent(definition: ToolComponentDefinition): ToolComponentDefinition {
  toolRegistry.set(definition.name, definition)
  return definition
}

export function defineHumanInTheLoop(
  definition: HumanInTheLoopDefinition
): HumanInTheLoopDefinition {
  hitlRegistry.set(definition.name, definition)
  return definition
}

export function getToolComponent(name: string): ToolComponentDefinition | undefined {
  return toolRegistry.get(name)
}

export function getHumanInTheLoop(name: string): HumanInTheLoopDefinition | undefined {
  return hitlRegistry.get(name)
}
