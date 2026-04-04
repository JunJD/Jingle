import { createElement, Fragment, type ComponentType } from "react"
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
import { nativeExtensionCommandRegistry } from "./registry"
import { useNativeExtensionViewStack } from "./view-stack-context"
import { NativeExtensionViewStackProvider } from "./view-stack"

const nativeExtensionCommandRegistryMap = new Map(
  nativeExtensionCommandRegistry.map(
    (entry) => [`${entry.extensionName}:${entry.command.name}`, entry] as const
  )
)

function getViewportHeight(
  viewport: NativeViewCommandModule["viewport"]
): (shellConfig: LauncherShellConfig) => number {
  if ("getHeight" in viewport) {
    return viewport.getHeight
  }

  return (shellConfig) => getLauncherViewportHeightForBody(viewport.bodyHeight, shellConfig)
}

function wrapNativeViewCommand(Component: ComponentType): ComponentType {
  function NativeViewCommandWithStack(): React.JSX.Element {
    const stack = useNativeExtensionViewStack()
    return createElement(
      Fragment,
      null,
      stack?.render(createElement(Component)) ?? createElement(Component)
    )
  }

  function WrappedNativeViewCommand(): React.JSX.Element {
    return createElement(
      NativeExtensionViewStackProvider,
      null,
      createElement(NativeViewCommandWithStack)
    )
  }

  WrappedNativeViewCommand.displayName = `WrappedNativeViewCommand(${
    Component.displayName ?? Component.name ?? "Anonymous"
  })`

  return WrappedNativeViewCommand
}

export const nativeLauncherPlugins = nativeExtensions.reduce<LauncherPluginDefinition[]>(
  (plugins, extension) => {
    const routeableCommands = extension.manifest.commands.filter(
      (command) => command.mode === "view" || command.mode === "no-view"
    )

    if (routeableCommands.length === 0) {
      return plugins
    }

    const launcherManifest = toLauncherPluginManifest(extension.manifest)
    validateLauncherPluginManifest(launcherManifest)

    plugins.push({
      commands: routeableCommands.map((command) => {
        const registryEntry = nativeExtensionCommandRegistryMap.get(
          `${extension.manifest.name}:${command.name}`
        )
        if (!registryEntry) {
          throw new Error(
            `Native extension "${extension.manifest.name}" command "${command.name}" is missing from the renderer registry`
          )
        }

        const search = registryEntry.module.search as
          | NativeViewCommandModule["search"]
          | NativeNoViewCommandModule["search"]
          | undefined
        const loadCommandPreferences = () =>
          window.api.nativeExtensions.getCommandPreferences(extension.manifest.name, command.name)
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
          const Component = registryEntry.module.default as
            | NativeViewCommandModule["default"]
            | undefined
          const viewport = registryEntry.module.viewport as
            | NativeViewCommandModule["viewport"]
            | undefined
          if (!Component || !viewport) {
            throw new Error(
              `Native extension "${extension.manifest.name}" view command "${command.name}" must export default component and viewport`
            )
          }

          return {
            Component: wrapNativeViewCommand(Component),
            buildIntentItems: search?.buildIntentItems,
            commandName: command.name,
            getViewportHeight: getViewportHeight(viewport),
            loadCommandPreferences,
            mode: "view" as const,
            validateCommandPreferences,
            resolveCommand: search?.resolveCommand
          }
        }

        const run = registryEntry.module.default as NativeNoViewCommandModule["default"] | undefined
        if (!run) {
          throw new Error(
            `Native extension "${extension.manifest.name}" command "${command.name}" must export a default run function`
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
    } satisfies LauncherPluginDefinition)

    return plugins
  },
  []
)
