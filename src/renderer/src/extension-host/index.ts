import { getLauncherViewportHeightForBody, type LauncherShellConfig } from "@shared/launcher"
import {
  listMissingRequiredNativeExtensionPreferences,
  supportsNativeExtensionPlatformList,
  toLauncherCommandOwnerManifestFromProjection,
  type NativeExtensionLauncherCatalogProjection,
  type NativeExtensionLauncherCommandProjection,
  type NativeExtensionSourceMentionProjection
} from "@shared/native-extensions"
import { resolveLocalizedText, type AppLocale } from "@shared/i18n"
import {
  normalizeExtensionRuntimeLaunchIntent,
  type ExtensionRuntimeInitialAction,
  type ExtensionRuntimeLaunchIntent,
  type ExtensionRuntimeLaunchProps
} from "@shared/extension-runtime-protocol"
import { validateLauncherCommandOwnerManifest } from "@shared/launcher-command-owner"
import { handleRuntimeNavigationRequest } from "@renderer/extension-runtime/runtime-navigation"
import type { AppCopy } from "@/lib/i18n/messages"
import type {
  LauncherCommandIntent,
  LauncherCommandOwnerDefinition
} from "@launcher-shell/pages/types"
import type {
  ExtensionAiCapabilityCatalogToolSummary,
  ExtensionSourceMention
} from "@shared/extension-sources"
import { lazy, useSyncExternalStore, type ComponentType } from "react"

const RuntimeExtensionCommandSurface = lazy(async () => {
  const module = await import("@renderer/extension-runtime/RuntimeExtensionCommandSurface")
  return { default: module.RuntimeExtensionCommandSurface }
}) as ComponentType

const EXTENSION_INTENT_PRIORITY = 200

interface ExtensionSearchMatch {
  priority: number
  remainder: string
  waitForLauncherArguments: boolean
}

type SearchTermMatchKind = "exact" | "phrase" | "prefix"

interface SearchTermMatch {
  kind: SearchTermMatchKind
  remainder: string
}

export function createRuntimeRunOnceLaunchIntent(input: {
  commandName: string
  extensionName: string
  initialAction: ExtensionRuntimeInitialAction
  launchProps?: ExtensionRuntimeLaunchProps
  seedQuery: string
}): ExtensionRuntimeLaunchIntent {
  return normalizeExtensionRuntimeLaunchIntent({
    commandName: input.commandName,
    extensionName: input.extensionName,
    initialAction: input.initialAction,
    ...(input.launchProps !== undefined ? { launchProps: input.launchProps } : {}),
    seedQuery: input.seedQuery
  })
}

const SEARCH_TEXT_COLLATOR = new Intl.Collator(undefined, {
  sensitivity: "base",
  usage: "search"
})

function appendSearchTerm(terms: string[], term: string): string[] {
  const trimmedTerm = term.trim()
  if (!trimmedTerm) {
    return terms
  }

  terms.push(trimmedTerm)
  return terms
}

function getCommandSearchMetadataTerms(
  command: NativeExtensionLauncherCommandProjection
): string[] {
  const terms: string[] = []
  const search = command.search

  if (search) {
    if (search.aliases) {
      terms.push(...search.aliases)
    }

    if (search.keywords) {
      terms.push(...search.keywords)
    }
  }

  if (command.keywords) {
    terms.push(...command.keywords)
  }

  return terms
}

function getViewportHeight(
  viewport: NativeExtensionLauncherCommandProjection["runtime"]["viewport"]
): (shellConfig: LauncherShellConfig) => number {
  if (!viewport) {
    throw new Error("Runtime view command is missing viewport metadata.")
  }

  return (shellConfig) => getLauncherViewportHeightForBody(viewport.bodyHeight, shellConfig)
}

function getSearchTerms(input: {
  command: NativeExtensionLauncherCommandProjection
  extension: NativeExtensionLauncherCatalogProjection
  locale: AppLocale
}): string[] {
  const { command, extension, locale } = input
  const terms = [
    ...getCommandSearchMetadataTerms(command),
    resolveLocalizedText(command.title, locale, command.name),
    resolveLocalizedText(extension.displayName, locale, extension.extName)
  ]

  return [...new Set(terms.reduce<string[]>(appendSearchTerm, []))]
}

function isSameSearchText(left: string, right: string): boolean {
  return SEARCH_TEXT_COLLATOR.compare(left, right) === 0
}

function startsWithSearchText(value: string, prefix: string): boolean {
  return prefix.length <= value.length && isSameSearchText(value.slice(0, prefix.length), prefix)
}

function matchSearchTerm(query: string, term: string): SearchTermMatch | null {
  const trimmedQuery = query.trim()
  const trimmedTerm = term.trim()
  if (!trimmedQuery || !trimmedTerm) {
    return null
  }

  if (isSameSearchText(trimmedQuery, trimmedTerm)) {
    return { kind: "exact", remainder: "" }
  }

  if (
    startsWithSearchText(trimmedQuery, trimmedTerm) &&
    trimmedQuery.charAt(trimmedTerm.length) === " "
  ) {
    return {
      kind: "phrase",
      remainder: trimmedQuery.slice(trimmedTerm.length).trim()
    }
  }

  if (startsWithSearchText(trimmedTerm, trimmedQuery)) {
    return { kind: "prefix", remainder: "" }
  }

  return null
}

function getSearchTermMatchPriority(kind: SearchTermMatchKind): number {
  switch (kind) {
    case "exact":
      return 40
    case "phrase":
      return 30
    case "prefix":
      return 10
  }
}

function getArgumentPriority(input: { remainder: string; requiresArgument: boolean }): number {
  if (!input.requiresArgument || !input.remainder) {
    return 0
  }

  return 50
}

function getSearchMatch(input: {
  command: NativeExtensionLauncherCommandProjection
  extension: NativeExtensionLauncherCatalogProjection
  locale: AppLocale
  query: string
}): ExtensionSearchMatch | null {
  const query = input.query.trim()
  if (!query) {
    return null
  }

  const requiresArgument = Boolean(input.command.search?.argumentHints?.length)
  const canAskForLauncherArguments =
    input.command.requiresLauncherArguments === true && Boolean(input.command.arguments?.length)
  let bestMatch: ExtensionSearchMatch | null = null

  for (const term of getSearchTerms(input)) {
    const termMatch = matchSearchTerm(query, term)
    if (!termMatch) {
      continue
    }

    const remainder = termMatch.remainder
    const waitForLauncherArguments = requiresArgument && !remainder && canAskForLauncherArguments
    if (requiresArgument && !remainder && !waitForLauncherArguments) {
      continue
    }

    const matchPriority = getSearchTermMatchPriority(termMatch.kind)
    const argumentPriority = getArgumentPriority({ remainder, requiresArgument })
    const priority =
      EXTENSION_INTENT_PRIORITY + matchPriority + argumentPriority + Math.min(term.length, 40)
    if (!bestMatch || priority > bestMatch.priority) {
      bestMatch = { priority, remainder, waitForLauncherArguments }
    }
  }

  return bestMatch
}

function getExtensionLaunchText(input: { query: string; remainder: string }): string {
  if (input.remainder) {
    return input.remainder
  }

  return input.query.trim()
}

function createSearchOpenOptions(input: {
  query: string
  remainder: string
  waitForLauncherArguments: boolean
}): LauncherCommandIntent["openOptions"] {
  if (input.waitForLauncherArguments) {
    return {
      seedQuery: input.query
    }
  }

  const launchText = getExtensionLaunchText(input)
  return {
    launchProps: {
      fallbackText: launchText
    },
    seedQuery: input.query
  }
}

function createSearchIntentItem(input: {
  command: NativeExtensionLauncherCommandProjection
  copy: AppCopy
  extension: NativeExtensionLauncherCatalogProjection
  locale: AppLocale
  match: ExtensionSearchMatch
  query: string
}): LauncherCommandIntent {
  const { command, copy, extension, locale, match, query } = input

  return {
    id: `extension-intent:${extension.extName}:${command.name}:${encodeURIComponent(query)}`,
    kind: "plugin" as const,
    openOptions: createSearchOpenOptions({
      query,
      remainder: match.remainder,
      waitForLauncherArguments: match.waitForLauncherArguments
    }),
    presentation: {
      categoryLabel: copy.launcher.resultKindExtension,
      icon: {
        extensionName: extension.extName,
        icon: command.icon,
        iconName: command.iconName,
        type: "extension" as const
      },
      listActionLabel: copy.launcher.openGeneric,
      primaryActionLabel: copy.launcher.openGeneric,
      tone: "neutral" as const
    },
    priority: match.priority,
    subtitle: [
      resolveLocalizedText(extension.displayName, locale, extension.extName),
      resolveLocalizedText(command.description, locale, "")
    ]
      .filter(Boolean)
      .join(" · "),
    title: resolveLocalizedText(command.title, locale, command.name)
  }
}

function buildSearchIntentItems(input: {
  command: NativeExtensionLauncherCommandProjection
  copy: AppCopy
  extension: NativeExtensionLauncherCatalogProjection
  locale: AppLocale
  query: string
}): LauncherCommandIntent[] {
  if (!input.command.search) {
    return []
  }

  const match = getSearchMatch(input)
  if (!match) {
    return []
  }

  return [
    createSearchIntentItem({
      ...input,
      match
    })
  ]
}

function hasSearchArguments(command: NativeExtensionLauncherCommandProjection): boolean {
  return Boolean(command.search?.argumentHints?.length)
}

let nativeLauncherCommandOwners: LauncherCommandOwnerDefinition[] = []
let nativeSourceMentionProjection: readonly NativeExtensionSourceMentionProjection[] = []
let nativeExtensionProjectionRevision = 0
const nativeExtensionProjectionListeners = new Set<() => void>()

function publishNativeExtensionProjection(): void {
  nativeExtensionProjectionRevision += 1
  for (const listener of nativeExtensionProjectionListeners) {
    listener()
  }
}

function subscribeNativeExtensionProjection(listener: () => void): () => void {
  nativeExtensionProjectionListeners.add(listener)
  return () => nativeExtensionProjectionListeners.delete(listener)
}

function getNativeExtensionProjectionRevision(): number {
  return nativeExtensionProjectionRevision
}

export function useNativeExtensionProjectionRevision(): number {
  return useSyncExternalStore(
    subscribeNativeExtensionProjection,
    getNativeExtensionProjectionRevision,
    getNativeExtensionProjectionRevision
  )
}

export function setNativeLauncherCatalogProjection(
  catalog: readonly NativeExtensionLauncherCatalogProjection[]
): void {
  nativeLauncherCommandOwners = buildNativeLauncherCommandOwners(catalog)
  publishNativeExtensionProjection()
}

export function setNativeSourceMentionProjection(
  sourceMentions: readonly NativeExtensionSourceMentionProjection[]
): void {
  nativeSourceMentionProjection = sourceMentions
  publishNativeExtensionProjection()
}

export function getNativeLauncherCommandOwners(): readonly LauncherCommandOwnerDefinition[] {
  return nativeLauncherCommandOwners
}

function toExtensionSourceMentionTool(
  tool: NativeExtensionSourceMentionProjection["tools"][number],
  locale: AppLocale
): ExtensionAiCapabilityCatalogToolSummary {
  const title = resolveLocalizedText(tool.title, locale, tool.toolName)
  return {
    access: tool.access,
    description: resolveLocalizedText(tool.description, locale, title),
    title,
    toolName: tool.toolName
  }
}

export function listNativeLauncherSourceMentions(
  platform: string,
  locale: AppLocale
): ExtensionSourceMention[] {
  return nativeSourceMentionProjection.flatMap((sourceMention) => {
    if (!supportsNativeExtensionPlatformList(sourceMention.supportedPlatforms, platform)) {
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
        tools: sourceMention.tools.map((tool) => toExtensionSourceMentionTool(tool, locale)),
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
        const buildIntentItems = command.search
          ? (params: { copy: AppCopy; locale: AppLocale; query: string }) =>
              buildSearchIntentItems({ command, extension, ...params })
          : undefined
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
            buildIntentItems,
            Component: RuntimeExtensionCommandSurface,
            commandName: command.name,
            getViewportHeight: getViewportHeight(command.runtime.viewport),
            loadCommandPreferences,
            mode: "view" as const,
            requiresSearchArgument: hasSearchArguments(command),
            validateCommandPreferences
          }
        }

        return {
          buildIntentItems,
          commandName: command.name,
          loadCommandPreferences,
          mode: "no-view" as const,
          requiresSearchArgument: hasSearchArguments(command),
          validateCommandPreferences,
          run: async (context) => {
            const runOnceSessionId = crypto.randomUUID()
            const showToast = context.showToast
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
            const unsubscribeToastRequests = showToast
              ? window.api.extensionRuntime.subscribeToastRequests((event) => {
                  if (event.sessionId !== runOnceSessionId) {
                    return
                  }

                  showToast(event)
                })
              : undefined

            try {
              const result = await window.api.extensionRuntime.runOnce({
                intent: createRuntimeRunOnceLaunchIntent({
                  commandName: command.name,
                  extensionName: extension.extName,
                  initialAction: context.initialAction,
                  launchProps: context.launchProps,
                  seedQuery: context.seedQuery
                }),
                sessionId: runOnceSessionId
              })

              if (result.status === "error") {
                throw new Error(result.error.message)
              }
            } finally {
              unsubscribeToastRequests?.()
              unsubscribeNavigationRequests?.()
            }
          }
        }
      }),
      manifest: commandOwnerManifest
    } satisfies LauncherCommandOwnerDefinition)

    return owners
  }, [])
}
