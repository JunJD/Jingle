import type { ComponentType } from "react"
import TodoList from "./todo-list/src/index"

interface NativeExtensionRuntimeCommandDefinition {
  Component: ComponentType
  commandName: string
  extensionName: string
}

const nativeExtensionRuntimeCommandDefinitions: NativeExtensionRuntimeCommandDefinition[] = [
  {
    Component: TodoList,
    commandName: "index",
    extensionName: "todo-list"
  }
]

const nativeExtensionRuntimeCommandDefinitionMap = new Map(
  nativeExtensionRuntimeCommandDefinitions.map(
    (definition) => [`${definition.extensionName}:${definition.commandName}`, definition] as const
  )
)

export function getNativeExtensionRuntimeCommand(params: {
  commandName: string
  extensionName: string
}): NativeExtensionRuntimeCommandDefinition | null {
  return (
    nativeExtensionRuntimeCommandDefinitionMap.get(
      `${params.extensionName}:${params.commandName}`
    ) ?? null
  )
}
