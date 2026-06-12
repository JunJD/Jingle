import { getLauncherViewportHeightForBody, type LauncherShellConfig } from "@shared/launcher"
import {
  listMissingRequiredNativeExtensionPreferences,
  supportsNativeExtensionPlatformList,
  toLauncherCommandOwnerManifestFromProjection,
  type NativeExtensionLauncherCatalogProjection,
  type NativeExtensionLauncherCommandProjection
} from "@shared/native-extensions"
import { resolveLocalizedText, type AppLocale } from "@shared/i18n"
import { validateLauncherCommandOwnerManifest } from "@shared/launcher-command-owner"
import { handleRuntimeNavigationRequest } from "@renderer/extension-runtime/runtime-navigation"
import type { LauncherCommandOwnerDefinition } from "@launcher-shell/pages/types"
import type { ExtensionSourceMention } from "@shared/extension-sources"
import { lazy, type ComponentType } from "react"

const RuntimeExtensionCommandSurface = lazy(async () => {
  const module = await import("@renderer/extension-runtime/RuntimeExtensionCommandSurface")
  return { default: module.RuntimeExtensionCommandSurface }
}) as ComponentType

function getViewportHeight(
  viewport: NativeExtensionLauncherCommandProjection["runtime"]["viewport"]
): (shellConfig: LauncherShellConfig) => number {
  if (!viewport) {
    throw new Error("Runtime view command is missing viewport metadata.")
  }

  return (shellConfig) => getLauncherViewportHeightForBody(viewport.bodyHeight, shellConfig)
}

let nativeLauncherCommandOwners: LauncherCommandOwnerDefinition[] = []
let nativeLauncherCatalogProjection: readonly NativeExtensionLauncherCatalogProjection[] = []

export function setNativeLauncherCatalogProjection(
  catalog: readonly NativeExtensionLauncherCatalogProjection[]
): void {
  nativeLauncherCatalogProjection = catalog
  nativeLauncherCommandOwners = buildNativeLauncherCommandOwners(catalog)
}

export function getNativeLauncherCommandOwners(): readonly LauncherCommandOwnerDefinition[] {
  return nativeLauncherCommandOwners
}

export function listNativeLauncherSourceMentions(
  platform: string,
  locale: AppLocale
): ExtensionSourceMention[] {
  return nativeLauncherCatalogProjection.flatMap((extension) => {
    const sourceMention = extension.sourceMention
    if (
      !sourceMention ||
      !supportsNativeExtensionPlatformList(sourceMention.supportedPlatforms, platform)
    ) {
      return []
    }

    return [
      {
        extensionName: sourceMention.extensionName,
        icon: sourceMention.icon,
        iconName: sourceMention.iconName,
        label: resolveLocalizedText(sourceMention.label, locale, sourceMention.value),
        sourceId: sourceMention.sourceId,
        supportedPlatforms: sourceMention.supportedPlatforms
          ? [...sourceMention.supportedPlatforms]
          : undefined,
        value: sourceMention.value
      }
    ]
  })
}

export function buildNativeLauncherCommandOwners(
  catalog: readonly NativeExtensionLauncherCatalogProjection[]
): LauncherCommandOwnerDefinition[] {
  return catalog.reduce<LauncherCommandOwnerDefinition[]>((owners, extension) => {
    if (extension.commands.length === 0) {
      return owners
    }

    const commandOwnerManifest = toLauncherCommandOwnerManifestFromProjection(extension)
    validateLauncherCommandOwnerManifest(commandOwnerManifest)

    owners.push({
      commands: extension.commands.map((command) => {
        const loadCommandPreferences = () =>
          window.api.nativeExtensions.getCommandPreferences(extension.extName, command.name)
        const validateCommandPreferences = (
          preferences: Record<string, unknown>,
          locale: Parameters<typeof resolveLocalizedText>[1]
        ) => {
          const missingPreferences = listMissingRequiredNativeExtensionPreferences(
            command.preferences,
            preferences,
            locale
          )

          if (missingPreferences.length === 0) {
            return null
          }

          return `Open Settings and configure ${missingPreferences.join(", ")} to run ${resolveLocalizedText(command.title, locale, command.name)}.`
        }

        if (command.mode === "view") {
          return {
            Component: RuntimeExtensionCommandSurface,
            commandName: command.name,
            getViewportHeight: getViewportHeight(command.runtime.viewport),
            loadCommandPreferences,
            mode: "view" as const,
            validateCommandPreferences
          }
        }

        return {
          commandName: command.name,
          loadCommandPreferences,
          mode: "no-view" as const,
          validateCommandPreferences,
          run: async (context) => {
            let runOnceSessionId: string | null = null
            const unsubscribeRunOnceSessions = window.api.extensionRuntime.subscribeRunOnceSessions(
              (session) => {
                if (
                  session.context.extensionName === extension.extName &&
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
                extensionName: extension.extName,
                extensionPreferences: {},
                initialAction: context.initialAction,
                launchProps: context.launchProps,
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
}
