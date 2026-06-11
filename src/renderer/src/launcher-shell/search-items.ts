import type { AppCopy } from "@/lib/i18n/messages"
import { createExtensionSourceReferenceUri } from "@shared/composer-reference-uri"
import type { ExtensionSourceMention } from "@shared/extension-sources"
import type { AppLocale } from "@shared/i18n"
import { AI_CHAT_COMMAND_NAME, AI_LAUNCHER_PLUGIN_ID } from "@shared/launcher-ai"
import type { LauncherHistoryItem } from "@shared/launcher-history"
import type { LocalStartItem } from "@shared/local-start"
import type { LauncherSearchResult } from "@shared/launcher-search"
import type { LauncherExtensionCommandAddress } from "./pages/types"
import type { LauncherIndexedCommand } from "./pages"
import { getLauncherIndexedCommand } from "./pages"
import { createLauncherBuiltinResultPresentation } from "./result-presentation"
import type { LauncherResultPresentation } from "./result-types"
import type { LauncherShellItem } from "./types"
import { getLauncherIndexedCommandIcon } from "./use-with-items"
export {
  buildLauncherCommandIntentShellItems,
  getLauncherIndexedCommandIcon,
  buildHighConfidenceUseWithCommandShellItems,
  buildLauncherUseWithCommandShellItems,
  buildLauncherUseWithShellItems
} from "./use-with-items"

const MAX_AI_EXTENSION_SOURCE_ITEMS = 12

interface ExtensionSourceMentionQuery {
  filterText: string
  seedQuery: string
}

function normalizeSearchText(value: string): string {
  return value.trim().toLowerCase()
}

function parseExtensionSourceMentionQuery(query: string): ExtensionSourceMentionQuery | null {
  const trimmedQuery = query.trim()
  if (!trimmedQuery.startsWith("@")) {
    return null
  }

  const mentionText = trimmedQuery.slice(1).trimStart()
  const [filterText = "", ...seedParts] = mentionText.split(/\s+/)

  return {
    filterText,
    seedQuery: seedParts.join(" ").trim()
  }
}

function scoreExtensionSourceMention(
  mention: ExtensionSourceMention,
  filterText: string
): number | null {
  const normalizedFilter = normalizeSearchText(filterText)
  if (!normalizedFilter) {
    return 1
  }

  const handle = normalizeSearchText(mention.value)
  const label = normalizeSearchText(mention.label)
  const extensionName = normalizeSearchText(mention.extensionName)
  const sourceId = normalizeSearchText(mention.sourceId)

  if (handle === normalizedFilter) {
    return 500
  }

  if (handle.startsWith(normalizedFilter)) {
    return 420
  }

  if (label.startsWith(normalizedFilter)) {
    return 360
  }

  if (extensionName.startsWith(normalizedFilter) || sourceId.startsWith(normalizedFilter)) {
    return 300
  }

  if (
    handle.includes(normalizedFilter) ||
    label.includes(normalizedFilter) ||
    extensionName.includes(normalizedFilter) ||
    sourceId.includes(normalizedFilter)
  ) {
    return 160
  }

  return null
}

function escapeMarkdownLabel(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\]/g, "\\]")
}

function escapeMarkdownUri(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\)/g, "\\)")
}

function createExtensionSourceReferenceText(mention: ExtensionSourceMention): string {
  const label = `@${mention.value}`
  const uri = createExtensionSourceReferenceUri(mention.extensionName, mention.sourceId)
  return `[${escapeMarkdownLabel(label)}](${escapeMarkdownUri(uri)})`
}

function createExtensionSourceSeedQuery(
  mention: ExtensionSourceMention,
  querySeed: string
): string {
  const referenceText = createExtensionSourceReferenceText(mention)
  return querySeed ? `${referenceText} ${querySeed}` : referenceText
}

export function buildLauncherAiExtensionSourceShellItems(params: {
  copy: AppCopy
  query: string
  sourceMentions: readonly ExtensionSourceMention[]
}): LauncherShellItem[] {
  const { copy, query, sourceMentions } = params
  const mentionQuery = parseExtensionSourceMentionQuery(query)
  if (!mentionQuery) {
    return []
  }

  return sourceMentions
    .flatMap((mention, index) => {
      const score = scoreExtensionSourceMention(mention, mentionQuery.filterText)
      if (score === null) {
        return []
      }

      return [
        {
          index,
          item: {
            action: {
              executor: "internal" as const,
              target: null,
              type: "none" as const
            },
            commandOpenOptions: {
              initialAction: "focus" as const,
              seedQuery: createExtensionSourceSeedQuery(mention, mentionQuery.seedQuery)
            },
            commandRef: {
              builtInId: AI_LAUNCHER_PLUGIN_ID,
              commandName: AI_CHAT_COMMAND_NAME,
              kind: "built-in-command" as const
            },
            id: [
              "ai-extension-source",
              mention.extensionName,
              mention.sourceId,
              encodeURIComponent(mentionQuery.seedQuery)
            ].join(":"),
            kind: "ai" as const,
            presentation: {
              categoryLabel: copy.launcher.resultKindAgent,
              icon: {
                extensionName: mention.extensionName,
                icon: mention.icon,
                iconName: mention.iconName,
                type: "extension" as const
              },
              listActionLabel: copy.launcher.openGeneric,
              primaryActionLabel: copy.launcher.aiPrimaryLabel,
              tone: "accent" as const
            },
            subtitle: copy.launcher.aiExtensionIntentSubtitle(`@${mention.value}`),
            title: copy.launcher.aiExtensionIntentTitle(mention.label),
            trailingLabel: copy.launcher.resultKindExtension
          },
          score
        }
      ]
    })
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score
      }

      return left.index - right.index
    })
    .slice(0, MAX_AI_EXTENSION_SOURCE_ITEMS)
    .map((entry) => entry.item)
}

function formatQuicklinkSubtitle(copy: AppCopy, result: LauncherSearchResult): string {
  const subtitle = result.subtitle.trim()
  const [extensionName, link] = subtitle.includes(" · ") ? subtitle.split(" · ", 2) : ["", subtitle]

  return [copy.launcher.resultKindQuicklink, extensionName, link].filter(Boolean).join(" · ")
}

function createLauncherQuicklinkPresentation(params: {
  copy: AppCopy
  indexedCommand: LauncherIndexedCommand | null
}): LauncherResultPresentation {
  const { copy, indexedCommand } = params

  return {
    categoryLabel: copy.launcher.resultKindQuicklink,
    icon: indexedCommand
      ? getLauncherIndexedCommandIcon(indexedCommand)
      : {
          name: "bookmark",
          type: "glyph"
        },
    listActionLabel: copy.launcher.openGeneric,
    primaryActionLabel: copy.launcher.openGeneric,
    tone: "neutral"
  }
}

export function buildLauncherSearchShellItems(
  copy: AppCopy,
  locale: AppLocale,
  searchResults: LauncherSearchResult[],
  options: { preview?: boolean } = {}
): LauncherShellItem[] {
  return searchResults.map((result) => {
    const availability = options.preview ? "planned" : result.availability
    const isQuicklink = result.source === "quicklinks"
    const extensionCommand =
      result.action.type === "open-extension-command" ? result.action.target : null
    const commandRef: LauncherExtensionCommandAddress | undefined = extensionCommand
      ? {
          commandName: extensionCommand.commandName,
          extensionName: extensionCommand.extensionName,
          kind: "extension-command"
        }
      : undefined
    const indexedCommand = commandRef ? getLauncherIndexedCommand(commandRef, locale) : null

    return {
      action: result.action,
      availability,
      commandOpenOptions: extensionCommand
        ? {
            launchProps: extensionCommand.launchProps
          }
        : undefined,
      commandRef,
      id: result.id,
      iconDataUrl: result.iconDataUrl,
      kind: result.kind,
      match: result.match,
      presentation: isQuicklink
        ? createLauncherQuicklinkPresentation({
            copy,
            indexedCommand
          })
        : extensionCommand
          ? {
              categoryLabel: copy.launcher.resultKindExtension,
              icon: indexedCommand
                ? getLauncherIndexedCommandIcon(indexedCommand)
                : {
                    extensionName: extensionCommand.extensionName,
                    type: "extension"
                  },
              listActionLabel: copy.launcher.openGeneric,
              primaryActionLabel: copy.launcher.openGeneric,
              tone: "neutral"
            }
          : createLauncherBuiltinResultPresentation({
              availability,
              copy,
              iconDataUrl: result.iconDataUrl,
              kind: result.kind
            }),
      subtitle: isQuicklink ? formatQuicklinkSubtitle(copy, result) : result.subtitle,
      title: result.title,
      trailingLabel: isQuicklink ? copy.launcher.resultKindQuicklink : undefined
    }
  })
}

export function buildLauncherLocalStartShellItems(
  copy: AppCopy,
  items: LocalStartItem[]
): LauncherShellItem[] {
  return items.map((item) => ({
    action: {
      executor: "shell",
      localStartItemId: item.id,
      target: {
        kind: item.kind,
        path: item.path
      },
      type: "open-path"
    },
    id: item.id,
    kind: item.kind,
    presentation: createLauncherBuiltinResultPresentation({
      copy,
      kind: item.kind
    }),
    subtitle: item.path,
    title: item.title
  }))
}

export function buildLauncherHistoryShellItems(
  copy: AppCopy,
  items: LauncherHistoryItem[]
): LauncherShellItem[] {
  return items.map((item) => ({
    action: item.action,
    id: item.id,
    iconDataUrl: item.iconDataUrl,
    kind: item.kind,
    pin: item.pin,
    presentation: createLauncherBuiltinResultPresentation({
      copy,
      iconDataUrl: item.iconDataUrl,
      kind: item.kind
    }),
    subtitle: item.subtitle,
    title: item.title
  }))
}

export function buildLauncherAiExtensionSourceShellItems(params: {
  copy: AppCopy
  query: string
  sourceMentions: readonly ExtensionSourceMention[]
}): LauncherShellItem[] {
  const query = params.query.trim().toLowerCase()
  if (!query.startsWith("@")) {
    return []
  }

  return params.sourceMentions
    .filter((mention) => mention.value.toLowerCase().startsWith(query))
    .map((mention) => ({
      action: {
        executor: "internal" as const,
        target: null,
        type: "none" as const
      },
      commandOpenOptions: {
        seedQuery: `${mention.value} `
      },
      commandRef: {
        builtInId: AI_LAUNCHER_PLUGIN_ID,
        commandName: AI_CHAT_COMMAND_NAME,
        kind: "built-in-command" as const
      },
      id: `ai-source:${mention.extensionName}:${mention.sourceId}`,
      kind: "ai" as const,
      presentation: {
        categoryLabel: params.copy.launcher.resultKindAgent,
        icon: {
          extensionName: mention.extensionName,
          icon: mention.icon,
          iconName: mention.iconName,
          type: "extension" as const
        },
        listActionLabel: params.copy.launcher.openGeneric,
        primaryActionLabel: params.copy.launcher.aiPrimaryLabel,
        tone: "accent" as const
      },
      subtitle: mention.extensionName,
      title: mention.label
    }))
}

function getInternalCommandQueryScore(
  command: LauncherIndexedCommand,
  normalizedQuery: string
): { match?: [number, number]; score: number } | null {
  const normalizedTitle = command.title.toLowerCase()
  const normalizedOwnerTitle = command.ownerTitle.toLowerCase()
  const normalizedDescription = command.description.toLowerCase()
  const normalizedKeywords = command.keywords.map((keyword) => keyword.toLowerCase())
  const titleMatch = getTitleMatch(command.title, normalizedQuery)

  if (normalizedTitle.startsWith(normalizedQuery)) {
    return {
      match: titleMatch,
      score: 420
    }
  }

  if (titleMatch) {
    return {
      match: titleMatch,
      score: 340
    }
  }

  if (normalizedKeywords.some((keyword) => keyword === normalizedQuery)) {
    return {
      score: 300
    }
  }

  if (normalizedKeywords.some((keyword) => keyword.includes(normalizedQuery))) {
    return {
      score: 260
    }
  }

  if (normalizedOwnerTitle.includes(normalizedQuery)) {
    return {
      score: 200
    }
  }

  if (normalizedDescription.includes(normalizedQuery)) {
    return {
      score: 120
    }
  }

  return null
}

export function buildLauncherInternalCommandShellItems(
  copy: AppCopy,
  commands: LauncherIndexedCommand[],
  query: string
): LauncherShellItem[] {
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) {
    return []
  }

  return commands
    .flatMap((command) => {
      const rankedMatch = getInternalCommandQueryScore(command, normalizedQuery)
      if (!rankedMatch) {
        return []
      }

      const item: LauncherShellItem = {
        action: {
          executor: "internal" as const,
          target: null,
          type: "none" as const
        },
        commandRef: command.address,
        id:
          command.address.kind === "built-in-command"
            ? `command:${command.address.builtInId}:${command.address.commandName}`
            : `command:${command.address.extensionName}:${command.address.commandName}`,
        kind: "plugin" as const,
        match: rankedMatch.match,
        presentation: {
          categoryLabel: copy.launcher.resultKindExtension,
          icon: getLauncherIndexedCommandIcon(command),
          listActionLabel: copy.launcher.openGeneric,
          primaryActionLabel: copy.launcher.openGeneric,
          tone: "neutral" as const
        },
        subtitle: [command.ownerTitle, command.description].filter(Boolean).join(" · "),
        title: command.title
      }

      return [
        {
          item,
          score: rankedMatch.score
        }
      ]
    })
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score
      }

      return left.item.title.localeCompare(right.item.title)
    })
    .map((entry) => entry.item)
}

function getTitleMatch(title: string, normalizedQuery: string): [number, number] | undefined {
  const matchIndex = title.toLowerCase().indexOf(normalizedQuery)
  if (matchIndex < 0) {
    return undefined
  }

  return [matchIndex, matchIndex + normalizedQuery.length - 1]
}

function createLauncherSuggestionPresentation(params: {
  actionLabel: string
  categoryLabel: string
  iconName: "globe" | "search"
}): LauncherResultPresentation {
  const { actionLabel, categoryLabel, iconName } = params

  return {
    categoryLabel,
    icon: {
      name: iconName,
      type: "glyph"
    },
    listActionLabel: actionLabel,
    primaryActionLabel: actionLabel,
    tone: "neutral"
  }
}

export function buildLauncherBrowserSearchSuggestionItem(
  copy: AppCopy,
  query: string
): LauncherShellItem {
  const encodedQuery = encodeURIComponent(query)

  return {
    action: {
      executor: "shell",
      target: {
        url: `https://www.google.com/search?q=${encodedQuery}`
      },
      type: "open-url"
    },
    id: `suggestion:browser-search:${query}`,
    kind: "suggestion",
    presentation: createLauncherSuggestionPresentation({
      actionLabel: copy.launcher.searchSuggestionAction,
      categoryLabel: copy.launcher.resultKindSuggestion,
      iconName: "globe"
    }),
    subtitle: copy.launcher.searchInBrowserSuggestionSubtitle,
    title: copy.launcher.searchInBrowserSuggestionTitle(query)
  }
}

export function buildLauncherCompletionSuggestionItem(
  copy: AppCopy,
  query: string
): LauncherShellItem {
  return {
    action: {
      executor: "internal",
      target: null,
      type: "none"
    },
    command: {
      type: "replace-query",
      value: query
    },
    id: `suggestion:complete-query:${query}`,
    kind: "suggestion",
    presentation: createLauncherSuggestionPresentation({
      actionLabel: copy.launcher.useSuggestedQueryAction,
      categoryLabel: copy.launcher.resultKindSuggestion,
      iconName: "search"
    }),
    subtitle: copy.launcher.useSuggestedQuerySubtitle,
    title: copy.launcher.useSuggestedQueryTitle(query)
  }
}
