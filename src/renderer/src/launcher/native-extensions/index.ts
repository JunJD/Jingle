import {
  getLauncherViewportHeightForBody,
  type LauncherShellConfig
} from "../../../../shared/launcher"
import {
  listMissingRequiredNativeExtensionPreferences,
  toLauncherPluginManifest
} from "../../../../shared/native-extensions"
import { validateLauncherPluginManifest } from "../../../../shared/launcher-plugin"
import { nativeExtensions } from "../../../../extensions"
import type { LauncherPluginDefinition } from "../pages/types"
import type { NativeNoViewCommandModule, NativeViewCommandModule } from "./sdk"

const nativeExtensionCommandModules = import.meta.glob("../../../../extensions/*/src/*.{ts,tsx}", {
  eager: true
}) as Record<string, Record<string, unknown>>

function getViewportHeight(
  viewport: NativeViewCommandModule["viewport"]
): (shellConfig: LauncherShellConfig) => number {
  if ("getHeight" in viewport) {
    return viewport.getHeight
  }

  return (shellConfig) => getLauncherViewportHeightForBody(viewport.bodyHeight, shellConfig)
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

export const nativeLauncherPlugins: LauncherPluginDefinition[] = nativeExtensions.map(
  ({ commands, manifest }) => {
    const launcherManifest = toLauncherPluginManifest(manifest)
    validateLauncherPluginManifest(launcherManifest)

    return {
      commands: manifest.commands.map((command) => {
        const commandReference = commands.find((entry) => entry.name === command.name)
        if (!commandReference) {
          throw new Error(
            `Native extension "${manifest.name}" command "${command.name}" is missing from src/extensions/${manifest.name}/index.ts`
          )
        }

        const commandModule = getNativeExtensionCommandModule({
          commandModulePath: commandReference.modulePath,
          extensionName: manifest.name
        })
        const search = commandModule.search as
          | NativeViewCommandModule["search"]
          | NativeNoViewCommandModule["search"]
          | undefined
        const loadCommandPreferences = () =>
          window.api.nativeExtensions.getCommandPreferences(manifest.name, command.name)
        const validateCommandPreferences = (preferences: Record<string, unknown>) => {
          const missingPreferences = listMissingRequiredNativeExtensionPreferences(
            command.preferences ?? [],
            preferences
          )

          if (missingPreferences.length === 0) {
            return null
          }

          return `Open Settings and configure ${missingPreferences.join(", ")} to run ${command.title ?? command.name}.`
        }

        if (command.mode === "view") {
          const Component = commandModule.default as NativeViewCommandModule["default"] | undefined
          const viewport = commandModule.viewport as NativeViewCommandModule["viewport"] | undefined
          if (!Component || !viewport) {
            throw new Error(
              `Native extension "${manifest.name}" view command "${command.name}" must export default component and viewport`
            )
          }

          return {
            Component,
            buildIntentItems: search?.buildIntentItems,
            commandName: command.name,
            getViewportHeight: getViewportHeight(viewport),
            loadCommandPreferences,
            mode: "view" as const,
            validateCommandPreferences,
            resolveCommand: search?.resolveCommand
          }
        }

        const run = commandModule.default as NativeNoViewCommandModule["default"] | undefined
        if (!run) {
          throw new Error(
            `Native extension "${manifest.name}" command "${command.name}" must export a default run function`
          )
        }

        return {
          buildIntentItems: search?.buildIntentItems,
          commandName: command.name,
          loadCommandPreferences,
          mode: "no-view" as const,
          validateCommandPreferences,
          resolveCommand: search?.resolveCommand,
          run
        }
      }),
      manifest: launcherManifest
    }
  }
)
