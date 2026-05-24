import { getLauncherViewportHeightForBody, type LauncherShellConfig } from "@shared/launcher"
import {
  listMissingRequiredNativeExtensionPreferences,
  toLauncherCommandOwnerManifest
} from "@shared/native-extensions"
import { validateLauncherCommandOwnerManifest } from "@shared/launcher-command-owner"
import { listNativeExtensionManifests } from "@extensions/index"
import { nativeExtensionRuntimeMetadata } from "@extensions/runtime-metadata"
import { handleRuntimeNavigationRequest } from "@renderer/extension-runtime/runtime-navigation"
import type { LauncherCommandOwnerDefinition } from "@launcher-shell/pages/types"
import { lazy, type ComponentType } from "react"

type NativeExtensionPlatformHost = typeof globalThis & {
  process?: {
    platform?: string
  }
  window?: {
    electron?: {
      process?: {
        platform?: string
      }
    }
  }
}

const RuntimeExtensionCommandSurface = lazy(async () => {
  const module = await import("@renderer/extension-runtime/RuntimeExtensionCommandSurface")
  return { default: module.RuntimeExtensionCommandSurface }
}) as ComponentType

function getNativeExtensionPlatform(): string {
  const host = globalThis as NativeExtensionPlatformHost
  const platform = host.window?.electron?.process?.platform ?? host.process?.platform

  if (!platform) {
    throw new Error("Native extension platform is unavailable.")
  }

  return platform
}

function getSupportedNativeExtensionManifests() {
  return listNativeExtensionManifests(getNativeExtensionPlatform())
}

function getViewportHeight(
  viewport: NonNullable<
    ReturnType<typeof getSupportedNativeExtensionManifests>[number]["commands"][number]["runtime"]
  >["viewport"]
): (shellConfig: LauncherShellConfig) => number {
  if (!viewport) {
    throw new Error("Runtime view command is missing viewport metadata.")
  }

  return (shellConfig) => getLauncherViewportHeightForBody(viewport.bodyHeight, shellConfig)
}

export const nativeLauncherCommandOwners = getSupportedNativeExtensionManifests().reduce<
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
      if (!command.runtime) {
        throw new Error(
          `Native extension "${extension.name}" command "${command.name}" must declare runtime metadata`
        )
      }

      const runtimeSearch = nativeExtensionRuntimeMetadata
        .get(extension.name)
        ?.commands.find((candidate) => candidate.name === command.name)?.search
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

      if (command.mode === "view") {
        return {
          Component: RuntimeExtensionCommandSurface,
          buildIntentItems: runtimeSearch?.buildIntentItems,
          commandName: command.name,
          getViewportHeight: getViewportHeight(command.runtime.viewport),
          loadCommandPreferences,
          mode: "view" as const,
          resolveCommand: runtimeSearch?.resolveCommand,
          validateCommandPreferences
        }
      }

      return {
        buildIntentItems: runtimeSearch?.buildIntentItems,
        commandName: command.name,
        loadCommandPreferences,
        mode: "no-view" as const,
        resolveCommand: runtimeSearch?.resolveCommand,
        validateCommandPreferences,
        run: async (context) => {
          let runOnceSessionId: string | null = null
          const unsubscribeRunOnceSessions = window.api.extensionRuntime.subscribeRunOnceSessions(
            (session) => {
              if (
                session.context.extensionName === extension.name &&
                session.context.commandName === command.name &&
                session.context.mode === "no-view"
              ) {
                runOnceSessionId = session.sessionId
              }
            }
          )
          const unsubscribeNavigationRequests = context.navigation
            ? window.api.extensionRuntime.subscribeNavigationRequests((event) => {
                if (event.sessionId !== runOnceSessionId || !context.navigation) {
                  return
                }

                void handleRuntimeNavigationRequest(event, context.navigation, {
                  completeOpenCommandBeforeNavigation: false
                })
              })
            : undefined

          try {
            const agentConfig = await window.api.settings.getAgentConfig()
            const result = await window.api.extensionRuntime.runOnce({
              commandName: command.name,
              commandPreferences: context.commandPreferences,
              extensionName: extension.name,
              extensionPreferences: {},
              initialAction: context.initialAction,
              locale: agentConfig.locale,
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
    }),
    manifest: commandOwnerManifest
  } satisfies LauncherCommandOwnerDefinition)

  return owners
}, [])
