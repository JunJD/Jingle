import { createElement, Fragment, type ComponentType } from "react"
import { getLauncherViewportHeightForBody, type LauncherShellConfig } from "@shared/launcher"
import {
  listMissingRequiredNativeExtensionPreferences,
  toLauncherCommandOwnerManifest
} from "@shared/native-extensions"
import { validateLauncherCommandOwnerManifest } from "@shared/launcher-command-owner"
import { listNativeExtensionManifests } from "@extensions/index"
import { nativeExtensionRendererDefinitions } from "@extensions/renderer"
import {
  handleRuntimeNavigationRequest,
  RuntimeExtensionCommandSurface
} from "@renderer/extension-runtime/RuntimeExtensionCommandSurface"
import type { LauncherCommandOwnerDefinition } from "@launcher-shell/pages/types"
import type { NativeNoViewCommandModule, NativeViewCommandModule } from "./sdk"
import { useNativeExtensionViewStack } from "./view-stack-context"
import { NativeExtensionViewStackProvider } from "./view-stack"

const supportedNativeExtensionManifests = listNativeExtensionManifests(
  window.electron.process.platform
)

export interface NativeExtensionCommandEntry {
  command: (typeof supportedNativeExtensionManifests)[number]["commands"][number]
  extensionCapabilities: (typeof supportedNativeExtensionManifests)[number]["capabilities"]
  extensionName: string
  extensionTitle: string
  module: Record<string, unknown>
}

export const nativeExtensionCommandEntries: NativeExtensionCommandEntry[] =
  supportedNativeExtensionManifests
    .flatMap((manifest) =>
      manifest.commands.map((command) => {
        if (command.runtime) {
          return null
        }

        const rendererEntry = nativeExtensionRendererDefinitions
          .get(manifest.name)
          ?.commands.find((candidate) => candidate.name === command.name)
        if (!rendererEntry) {
          throw new Error(
            `Native extension "${manifest.name}" command "${command.name}" is missing from its renderer definition`
          )
        }

        return {
          command,
          extensionCapabilities: manifest.capabilities,
          extensionName: manifest.name,
          extensionTitle: manifest.title,
          module: {
            ...rendererEntry.commandModule,
            ...(rendererEntry.metaModule ?? {})
          }
        } satisfies NativeExtensionCommandEntry
      })
    )
    .filter((entry): entry is NativeExtensionCommandEntry => entry !== null)
    .sort((left, right) => {
      const extensionOrder = left.extensionTitle.localeCompare(right.extensionTitle)
      if (extensionOrder !== 0) {
        return extensionOrder
      }

      return (left.command.title ?? left.command.name).localeCompare(
        right.command.title ?? right.command.name
      )
    })

const nativeExtensionCommandEntryMap = new Map(
  nativeExtensionCommandEntries.map(
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

export const nativeLauncherCommandOwners = supportedNativeExtensionManifests.reduce<
  LauncherCommandOwnerDefinition[]
>((owners, extension) => {
  const routeableCommands = extension.commands.filter(
    (command) => command.mode === "view" || command.mode === "no-view"
  )

  if (routeableCommands.length === 0) {
    return owners
  }

  const commandOwnerManifest = toLauncherCommandOwnerManifest(extension)
  validateLauncherCommandOwnerManifest(commandOwnerManifest)

  owners.push({
    commands: routeableCommands.map((command) => {
      const loadCommandPreferences = () =>
        window.api.nativeExtensions.getCommandPreferences(extension.name, command.name)
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

      if (command.runtime) {
        if (command.mode === "view") {
          if (!command.runtime.viewport) {
            throw new Error(
              `Native extension "${extension.name}" runtime view command "${command.name}" must declare viewport metadata`
            )
          }

          return {
            Component: RuntimeExtensionCommandSurface,
            commandName: command.name,
            getViewportHeight: getViewportHeight(command.runtime.viewport),
            loadCommandPreferences,
            mode: "view" as const,
            validateCommandPreferences
          }
        }

        if (command.mode === "no-view") {
          return {
            commandName: command.name,
            loadCommandPreferences,
            mode: "no-view" as const,
            validateCommandPreferences,
            run: async (context) => {
              let runOnceSessionId: string | null = null
              const unsubscribeRunOnceSessions =
                window.api.extensionRuntime.subscribeRunOnceSessions((session) => {
                  if (
                    session.context.extensionName === extension.name &&
                    session.context.commandName === command.name &&
                    session.context.mode === "no-view"
                  ) {
                    runOnceSessionId = session.sessionId
                  }
                })
              const unsubscribeNavigationRequests = context.navigation
                ? window.api.extensionRuntime.subscribeNavigationRequests((event) => {
                    if (event.sessionId !== runOnceSessionId || !context.navigation) {
                      return
                    }

                    void handleRuntimeNavigationRequest(event, context.navigation)
                  })
                : undefined

              try {
                const result = await window.api.extensionRuntime.runOnce({
                  commandName: command.name,
                  commandPreferences: context.commandPreferences,
                  extensionName: extension.name,
                  extensionPreferences: {},
                  initialAction: context.initialAction,
                  mode: "no-view",
                  seedQuery: context.seedQuery
                })

                if (result.status === "error") {
                  throw new Error(result.error.message)
                }
              } finally {
                unsubscribeNavigationRequests?.()
                unsubscribeRunOnceSessions()
              }
            }
          }
        }

        if (command.mode === "menu-bar" || command.mode === "background") {
          throw new Error(
            `Native extension "${extension.name}" runtime command "${command.name}" must be a view or no-view command`
          )
        }
      }

      const registryEntry = nativeExtensionCommandEntryMap.get(`${extension.name}:${command.name}`)
      if (!registryEntry) {
        throw new Error(
          `Native extension "${extension.name}" command "${command.name}" is missing from the renderer definition`
        )
      }

      const search = registryEntry.module.search as
        | NativeViewCommandModule["search"]
        | NativeNoViewCommandModule["search"]
        | undefined

      if (command.mode === "view") {
        const Component = registryEntry.module.default as
          | NativeViewCommandModule["default"]
          | undefined
        const viewport = registryEntry.module.viewport as
          | NativeViewCommandModule["viewport"]
          | undefined
        if (!Component || !viewport) {
          throw new Error(
            `Native extension "${extension.name}" view command "${command.name}" must export default component and viewport`
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
          `Native extension "${extension.name}" command "${command.name}" must export a default run function`
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
    manifest: commandOwnerManifest
  } satisfies LauncherCommandOwnerDefinition)

  return owners
}, [])
