import type { ComponentType } from "react"
import { nativeExtensions } from "../../../../extensions"
import type { NativeExtensionCommandManifest } from "../../../../shared/native-extensions"

const nativeExtensionCommandModules = import.meta.glob("../../../../extensions/*/src/*.{ts,tsx}", {
  eager: true
}) as Record<string, Record<string, unknown>>

const nativeExtensionCommandMetaModules = import.meta.glob(
  "../../../../extensions/*/src/*.meta.ts",
  {
    eager: true
  }
) as Record<string, Record<string, unknown>>

export interface NativeExtensionViewModule {
  default: ComponentType
  viewport:
    | {
        bodyHeight: number
      }
    | {
        getHeight: (
          shellConfig: import("../../../../shared/launcher").LauncherShellConfig
        ) => number
      }
}

export interface NativeExtensionNoViewModule {
  default: (
    context: import("../pages/types").LauncherNoViewPluginRunContext
  ) => Promise<void> | void
}

export interface NativeExtensionBackgroundModule {
  default: ComponentType
}

export interface NativeExtensionMenuBarModule {
  default: ComponentType
}

export interface NativeExtensionCommandRegistryEntry {
  command: NativeExtensionCommandManifest
  extensionCapabilities: (typeof nativeExtensions)[number]["manifest"]["capabilities"]
  extensionName: string
  extensionTitle: string
  module: Record<string, unknown>
}

function getNativeExtensionCommandModule(params: {
  commandModulePath: string
  extensionName: string
}): Record<string, unknown> {
  const modulePath = `../../../../extensions/${params.extensionName}/${params.commandModulePath.slice(2)}`
  const commandModule = nativeExtensionCommandModules[modulePath]

  if (!commandModule) {
    throw new Error(
      `Native extension "${params.extensionName}" command module "${params.commandModulePath}" does not exist`
    )
  }

  return commandModule
}

function getNativeExtensionCommandMetaModule(params: {
  commandModulePath: string
  extensionName: string
}): Record<string, unknown> {
  const metaModulePath = `../../../../extensions/${params.extensionName}/${params.commandModulePath
    .slice(2)
    .replace(/\.(ts|tsx)$/, ".meta.ts")}`

  return nativeExtensionCommandMetaModules[metaModulePath] ?? {}
}

export const nativeExtensionCommandRegistry: NativeExtensionCommandRegistryEntry[] =
  nativeExtensions
    .flatMap((extension) =>
      extension.manifest.commands.map((command) => {
        const commandReference = extension.commands.find((entry) => entry.name === command.name)
        if (!commandReference) {
          throw new Error(
            `Native extension "${extension.manifest.name}" command "${command.name}" is missing from src/extensions/${extension.manifest.name}/index.ts`
          )
        }

        return {
          command,
          extensionCapabilities: extension.manifest.capabilities,
          extensionName: extension.manifest.name,
          extensionTitle: extension.manifest.title,
          module: {
            ...getNativeExtensionCommandModule({
              commandModulePath: commandReference.modulePath,
              extensionName: extension.manifest.name
            }),
            ...getNativeExtensionCommandMetaModule({
              commandModulePath: commandReference.modulePath,
              extensionName: extension.manifest.name
            })
          }
        } satisfies NativeExtensionCommandRegistryEntry
      })
    )
    .sort((left, right) => {
      const extensionOrder = left.extensionTitle.localeCompare(right.extensionTitle)
      if (extensionOrder !== 0) {
        return extensionOrder
      }

      return (left.command.title ?? left.command.name).localeCompare(
        right.command.title ?? right.command.name
      )
    })
