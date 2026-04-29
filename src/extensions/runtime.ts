import type { ComponentType } from "react"
import AppleRemindersCreateReminder from "./apple-reminders/src/create-reminder"
import AppleRemindersMyReminders from "./apple-reminders/src/my-reminders"
import TodoList from "./todo-list/src/index"

interface NativeExtensionRuntimeCommandDefinition {
  Component: ComponentType
  commandName: string
  extensionName: string
}

const nativeExtensionRuntimeCommandDefinitions: NativeExtensionRuntimeCommandDefinition[] = [
  {
    Component: AppleRemindersCreateReminder,
    commandName: "create-reminder",
    extensionName: "apple-reminders"
  },
  {
    Component: AppleRemindersMyReminders,
    commandName: "my-reminders",
    extensionName: "apple-reminders"
  },
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
