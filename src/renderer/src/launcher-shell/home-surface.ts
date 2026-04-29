import type { AppCopy } from "@/lib/i18n/messages"
import type { AppLocale } from "@shared/i18n"
import {
  getLauncherResultsHeight,
  getLauncherSectionedResultsHeight,
  type LauncherShellConfig
} from "@shared/launcher"
import { sortLauncherHistoryItems, type LauncherHistoryItem } from "@shared/launcher-history"
import type { LauncherSearchResult } from "@shared/launcher-search"
import type { LocalStartItem } from "@shared/local-start"
import { shouldShowLauncherIdleItems } from "@shared/launcher-settings"
import { getLauncherCommandIntents, listLauncherCommands } from "./pages"
import {
  buildLauncherBrowserSearchSuggestionItem,
  buildLauncherCommandIntentShellItems,
  buildLauncherCompletionSuggestionItem,
  buildLauncherHistoryShellItems,
  buildLauncherInternalCommandShellItems,
  buildLauncherLocalStartShellItems,
  buildLauncherSearchShellItems,
  buildLauncherUseWithShellItems
} from "./search-items"
import type { LauncherShellItem } from "./types"

export type LauncherHomeSurfaceSectionKind =
  | "history-grid"
  | "idle-list"
  | "commands"
  | "suggestions"
  | "search-results"
  | "use-with"

export type LauncherHomeSurfaceBodyKind = "history-grid" | "result-list"

export interface LauncherHomeSurfaceSection {
  action?: {
    title: string
    type: "manage-use-with"
  }
  items: LauncherShellItem[]
  kind: LauncherHomeSurfaceSectionKind
  title?: string
}

export interface LauncherHomeSurfaceBody {
  kind: LauncherHomeSurfaceBodyKind
}

export interface LauncherHomeSurfaceChrome {
  footerVisible: boolean
  headerDividerVisible: boolean
}

export interface LauncherHomeSurfaceModel {
  body: LauncherHomeSurfaceBody
  chrome: LauncherHomeSurfaceChrome
  items: LauncherShellItem[]
  sections: LauncherHomeSurfaceSection[]
  selection: {
    defaultItemId: string | null
  }
}

function hasLauncherHomeSurfaceSectionHeader(section: LauncherHomeSurfaceSection): boolean {
  return (
    section.kind === "commands" ||
    section.kind === "search-results" ||
    section.kind === "suggestions" ||
    section.kind === "use-with"
  )
}

function createHomeSurfaceModel(
  bodyKind: LauncherHomeSurfaceBodyKind,
  sections: LauncherHomeSurfaceSection[],
  chrome?: Partial<LauncherHomeSurfaceChrome>
): LauncherHomeSurfaceModel {
  const items = sections.flatMap((section) => section.items)

  return {
    body: {
      kind: bodyKind
    },
    chrome: {
      footerVisible: chrome?.footerVisible ?? items.length > 0,
      headerDividerVisible: chrome?.headerDividerVisible ?? items.length > 0
    },
    items,
    sections,
    selection: {
      defaultItemId: items[0]?.id ?? null
    }
  }
}

function rankHistorySectionItems(historyItems: LauncherHistoryItem[]): LauncherHistoryItem[] {
  return sortLauncherHistoryItems(historyItems)
}

function rankSearchResultSectionItems(
  searchResults: LauncherSearchResult[],
  historyItems: LauncherHistoryItem[]
): LauncherSearchResult[] {
  const historyByKey = new Map(historyItems.map((item) => [item.historyKey, item]))

  return searchResults
    .map((result, index) => ({
      history: result.historyKey ? historyByKey.get(result.historyKey) : undefined,
      index,
      result
    }))
    .sort((left, right) => {
      if (right.result.score !== left.result.score) {
        return right.result.score - left.result.score
      }

      if (Boolean(right.history) !== Boolean(left.history)) {
        return right.history ? 1 : -1
      }

      if (left.history && right.history) {
        if (left.history.pin !== right.history.pin) {
          return left.history.pin ? -1 : 1
        }

        if (left.history.lastUsedAt !== right.history.lastUsedAt) {
          return right.history.lastUsedAt.localeCompare(left.history.lastUsedAt)
        }

        if (left.history.useCount !== right.history.useCount) {
          return right.history.useCount - left.history.useCount
        }
      }

      return left.index - right.index
    })
    .map((entry) => entry.result)
}

function createSuggestionSectionItems(
  copy: AppCopy,
  query: string,
  searchResults: LauncherSearchResult[]
): LauncherShellItem[] {
  const suggestions: LauncherShellItem[] = [buildLauncherBrowserSearchSuggestionItem(copy, query)]
  const topResultTitle = searchResults[0]?.title.trim()

  if (topResultTitle && topResultTitle.localeCompare(query, undefined, { sensitivity: "accent" })) {
    suggestions.push(buildLauncherCompletionSuggestionItem(copy, topResultTitle))
  }

  return suggestions
}

export function buildLauncherHomeSurfaceModel(params: {
  copy: AppCopy
  historyItems: LauncherHistoryItem[]
  idleItems: LocalStartItem[]
  locale: AppLocale
  query: string
  searchResults: LauncherSearchResult[]
  searchResultsPreview?: boolean
  useWithDisabledCommandKeys?: readonly string[]
  windowMode: "default" | "compact"
}): LauncherHomeSurfaceModel {
  const {
    copy,
    historyItems,
    idleItems,
    locale,
    query,
    searchResults,
    searchResultsPreview = false,
    useWithDisabledCommandKeys = [],
    windowMode
  } = params
  const trimmedQuery = query.trim()

  if (!trimmedQuery) {
    if (!shouldShowLauncherIdleItems(windowMode)) {
      return createHomeSurfaceModel("result-list", [])
    }

    if (historyItems.length > 0) {
      const rankedHistoryItems = rankHistorySectionItems(historyItems)
      return createHomeSurfaceModel(
        "history-grid",
        [
          {
            items: buildLauncherHistoryShellItems(copy, rankedHistoryItems),
            kind: "history-grid"
          }
        ],
        { footerVisible: true }
      )
    }

    const localStartItems = buildLauncherLocalStartShellItems(copy, idleItems)
    return createHomeSurfaceModel(
      "result-list",
      [
        {
          items: localStartItems,
          kind: "idle-list"
        }
      ],
      { footerVisible: localStartItems.length > 0 }
    )
  }

  const sections: LauncherHomeSurfaceSection[] = []
  const launcherCommands = listLauncherCommands()
  const extensionCommands = launcherCommands.filter(
    (command) => command.address.kind === "extension-command"
  )
  const builtInCommands = launcherCommands.filter(
    (command) => command.address.kind === "built-in-command"
  )
  const internalCommandItems = buildLauncherInternalCommandShellItems(copy, builtInCommands, query)
  const commandIntentItems = getLauncherCommandIntents({
    copy,
    locale,
    query
  })
  const builtInCommandIntentItems = buildLauncherCommandIntentShellItems(
    commandIntentItems.filter((item) => item.address.kind === "built-in-command")
  )
  const useWithItems = buildLauncherUseWithShellItems({
    commands: extensionCommands,
    copy,
    disabledCommandKeys: useWithDisabledCommandKeys,
    intentItems: commandIntentItems,
    query: trimmedQuery
  })
  const rankedSearchResults = rankSearchResultSectionItems(searchResults, historyItems)
  const suggestionItems = createSuggestionSectionItems(copy, trimmedQuery, rankedSearchResults)
  const searchResultItems = buildLauncherSearchShellItems(copy, rankedSearchResults, {
    preview: searchResultsPreview
  })

  const primaryResultItems = [...builtInCommandIntentItems, ...searchResultItems]
  if (primaryResultItems.length > 0) {
    sections.push({
      items: primaryResultItems,
      kind: "search-results"
    })
  }

  if (useWithItems.length > 0 || extensionCommands.length > 0) {
    sections.push({
      action: {
        title: copy.launcher.manageUseWithCommands,
        type: "manage-use-with"
      },
      items: useWithItems,
      kind: "use-with",
      title: copy.launcher.useWithSectionTitle(trimmedQuery)
    })
  }

  if (internalCommandItems.length > 0) {
    sections.push({
      items: internalCommandItems,
      kind: "commands"
    })
  }

  if (suggestionItems.length > 0) {
    sections.push({
      items: suggestionItems,
      kind: "suggestions"
    })
  }

  return createHomeSurfaceModel("result-list", sections, { footerVisible: true })
}

export function getLauncherHomeSurfaceResultsHeight(
  surface: LauncherHomeSurfaceModel,
  shellConfig: LauncherShellConfig
): number {
  if (surface.body.kind === "history-grid") {
    const columns = 8
    const rows = Math.ceil(surface.items.length / columns)
    return rows * shellConfig.historyGridItemHeight
  }

  const sectionHeaderCount = surface.sections.filter(hasLauncherHomeSurfaceSectionHeader).length
  return getLauncherSectionedResultsHeight(surface.items.length, sectionHeaderCount, shellConfig)
}

export function getLauncherSearchResultsViewportHeight(shellConfig: LauncherShellConfig): number {
  return getLauncherResultsHeight(shellConfig.maxVisibleResults, shellConfig)
}

export function resolveLauncherHomeSurfaceSelectedIndex(
  surface: LauncherHomeSurfaceModel,
  selectedItemId: string | null
): number {
  if (surface.items.length === 0 || !surface.selection.defaultItemId) {
    return -1
  }

  if (!selectedItemId) {
    return surface.items.findIndex((item) => item.id === surface.selection.defaultItemId)
  }

  const matchingIndex = surface.items.findIndex((item) => item.id === selectedItemId)
  if (matchingIndex >= 0) {
    return matchingIndex
  }

  return surface.items.findIndex((item) => item.id === surface.selection.defaultItemId)
}
