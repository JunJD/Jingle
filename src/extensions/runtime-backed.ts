export interface NativeExtensionRuntimeBackedCommand {
  commandName: string
  extensionName: string
}

export const nativeExtensionRuntimeBackedCommands =
  [] as const satisfies readonly NativeExtensionRuntimeBackedCommand[]
