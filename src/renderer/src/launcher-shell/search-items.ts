import type { AppCopy } from "@/lib/i18n/messages"
import type { LauncherHistoryItem } from "@shared/launcher-history"
import type { LocalStartItem } from "@shared/local-start"
import type { LauncherSearchResult } from "@shared/launcher-search"
import type { LauncherResolvedCommandIntent } from "./pages/types"
import type { LauncherIndexedCommand } from "./pages"
import { createLauncherBuiltinResultPresentation } from "./result-presentation"
import type { LauncherResultPresentation } from "./result-types"
import type { LauncherShellItem } from "./types"

export function buildLauncherSearchShellItems(
  copy: AppCopy,
  searchResults: LauncherSearchResult[]
): LauncherShellItem[] {
  return searchResults.map((result) => ({
    action: result.action,
    availability: result.availability,
    id: result.id,
    iconDataUrl: result.iconDataUrl,
    kind: result.kind,
    match: result.match,
    presentation: createLauncherBuiltinResultPresentation({
      availability: result.availability,
      copy,
      iconDataUrl: result.iconDataUrl,
      kind: result.kind
    }),
    subtitle: result.subtitle,
    title: result.title
  }))
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

export function buildLauncherCommandIntentShellItems(
  items: LauncherResolvedCommandIntent[]
): LauncherShellItem[] {
  return items.map((item) => ({
    action: {
      executor: "internal",
      target: null,
      type: "none"
    },
    commandOpenOptions: item.openOptions,
    commandRef: item.address,
    id: item.id,
    kind: item.kind,
    presentation: item.presentation,
    subtitle: item.subtitle,
    title: item.title
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

      return [
        {
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
            icon: {
              name: "search",
              type: "glyph" as const
            },
            listActionLabel: copy.launcher.openGeneric,
            primaryActionLabel: copy.launcher.openGeneric,
            tone: "neutral" as const
          },
          score: rankedMatch.score,
          subtitle: [command.ownerTitle, command.description].filter(Boolean).join(" · "),
          title: command.title
        }
      ]
    })
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score
      }

      return left.title.localeCompare(right.title)
    })
    .map(({ score: _score, ...item }) => item)
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
