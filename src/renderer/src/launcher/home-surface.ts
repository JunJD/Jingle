import type { AppCopy } from "@/lib/i18n/messages"
import type { AppLocale } from "../../../shared/i18n"
import {
  getLauncherSectionedResultsHeight,
  type LauncherShellConfig
} from "../../../shared/launcher"
import {
  sortLauncherHistoryItems,
  type LauncherHistoryItem
} from "../../../shared/launcher-history"
import type { LauncherSearchResult } from "../../../shared/launcher-search"
import type { LocalStartItem } from "../../../shared/local-start"
import { shouldShowLauncherIdleItems } from "../../../shared/launcher-settings"
import { getLauncherPluginIntents } from "./pages"
import {
  buildLauncherBrowserSearchSuggestionItem,
  buildLauncherCompletionSuggestionItem,
  buildLauncherHistoryShellItems,
  buildLauncherLocalStartShellItems,
  buildLauncherPluginIntentShellItems,
  buildLauncherSearchShellItems
} from "./search-items"
import type { LauncherShellItem } from "./types"

export type LauncherHomeSurfaceSectionKind =
  | "history-grid"
  | "idle-list"
  | "plugin-intents"
  | "suggestions"
  | "search-results"

export type LauncherHomeSurfaceBodyKind = "history-grid" | "result-list"

export interface LauncherHomeSurfaceSection {
  items: LauncherShellItem[]
  kind: LauncherHomeSurfaceSectionKind
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
  return section.kind === "suggestions"
}

function createHomeSurfaceModel(
  bodyKind: LauncherHomeSurfaceBodyKind,
  sections: LauncherHomeSurfaceSection[]
): LauncherHomeSurfaceModel {
  const items = sections.flatMap((section) => section.items)

  return {
    body: {
      kind: bodyKind
    },
    chrome: {
      footerVisible: items.length > 0,
      headerDividerVisible: items.length > 0
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
  windowMode: "default" | "compact"
}): LauncherHomeSurfaceModel {
  const { copy, historyItems, idleItems, locale, query, searchResults, windowMode } = params
  const trimmedQuery = query.trim()

  if (!trimmedQuery) {
    if (!shouldShowLauncherIdleItems(windowMode)) {
      return createHomeSurfaceModel("result-list", [])
    }

    if (historyItems.length > 0) {
      const rankedHistoryItems = rankHistorySectionItems(historyItems)
      return createHomeSurfaceModel("history-grid", [
        {
          items: buildLauncherHistoryShellItems(copy, rankedHistoryItems),
          kind: "history-grid"
        }
      ])
    }

    return createHomeSurfaceModel("result-list", [
      {
        items: buildLauncherLocalStartShellItems(copy, idleItems),
        kind: "idle-list"
      }
    ])
  }

  const sections: LauncherHomeSurfaceSection[] = []
  const pluginIntentItems = buildLauncherPluginIntentShellItems(
    getLauncherPluginIntents({
      copy,
      locale,
      query
    })
  )
  const rankedSearchResults = rankSearchResultSectionItems(searchResults, historyItems)
  const suggestionItems = createSuggestionSectionItems(copy, trimmedQuery, rankedSearchResults)
  const searchResultItems = buildLauncherSearchShellItems(copy, rankedSearchResults)

  if (pluginIntentItems.length > 0) {
    sections.push({
      items: pluginIntentItems,
      kind: "plugin-intents"
    })
  }

  if (searchResultItems.length > 0) {
    sections.push({
      items: searchResultItems,
      kind: "search-results"
    })
  }

  if (suggestionItems.length > 0) {
    sections.push({
      items: suggestionItems,
      kind: "suggestions"
    })
  }

  return createHomeSurfaceModel("result-list", sections)
}

export function getLauncherHomeSurfaceResultsHeight(
  surface: LauncherHomeSurfaceModel,
  shellConfig: LauncherShellConfig
): number {
  if (surface.body.kind === "history-grid") {
    const columns = 8
    const rows = Math.ceil(surface.items.length / columns)
    return rows * 70
  }

  const sectionHeaderCount = surface.sections.filter(hasLauncherHomeSurfaceSectionHeader).length
  return getLauncherSectionedResultsHeight(surface.items.length, sectionHeaderCount, shellConfig)
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
