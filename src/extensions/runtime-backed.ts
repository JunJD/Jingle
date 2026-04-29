import { viewport as createReminderViewport } from "./apple-reminders/src/create-reminder.meta"
import { viewport as myRemindersViewport } from "./apple-reminders/src/my-reminders.meta"
import { viewport as todoListViewport } from "./todo-list/src/index.meta"

export interface NativeExtensionRuntimeBackedCommand {
  commandName: string
  extensionName: string
  viewport: {
    bodyHeight: number
  }
}

export const nativeExtensionRuntimeBackedCommands = [
  {
    extensionName: "apple-reminders",
    commandName: "create-reminder",
    viewport: createReminderViewport
  },
  {
    extensionName: "apple-reminders",
    commandName: "my-reminders",
    viewport: myRemindersViewport
  },
  {
    extensionName: "todo-list",
    commandName: "index",
    viewport: todoListViewport
  }
] as const satisfies readonly NativeExtensionRuntimeBackedCommand[]

export function getNativeExtensionRuntimeBackedCommand(params: {
  commandName: string
  extensionName: string
}): NativeExtensionRuntimeBackedCommand | null {
  return (
    nativeExtensionRuntimeBackedCommands.find(
      (command) =>
        command.commandName === params.commandName && command.extensionName === params.extensionName
    ) ?? null
  )
}
