import type {
  NativeExtensionRuntimeCommandDefinition,
  NativeExtensionRuntimePackage
} from "./runtime-contract"
import { nativeExtensionRuntimePackages } from "./runtime-packages"

const nativeExtensionRuntimeCommandDefinitionMap = new Map<
  string,
  NativeExtensionRuntimeCommandDefinition
>(
  nativeExtensionRuntimePackages.flatMap((runtimePackage) =>
    Object.entries(runtimePackage.commands).map(([commandName, command]) => [
      getCommandKey(runtimePackage.extensionName, commandName),
      {
        ...command,
        commandName,
        extensionName: runtimePackage.extensionName
      } satisfies NativeExtensionRuntimeCommandDefinition
    ])
  )
)

export type { NativeExtensionRuntimeCommandDefinition, NativeExtensionRuntimePackage }

export function getNativeExtensionRuntimeCommand(params: {
  commandName: string
  extensionName: string
}): NativeExtensionRuntimeCommandDefinition | null {
  return (
    nativeExtensionRuntimeCommandDefinitionMap.get(
      getCommandKey(params.extensionName, params.commandName)
    ) ?? null
  )
}

function getCommandKey(extensionName: string, commandName: string): string {
  return `${extensionName}:${commandName}`
}
