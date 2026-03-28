import type { AppCopy } from "@/lib/i18n/messages"
import type { AppLocale } from "../../../shared/i18n"
import { getLauncherResultsHeight, type LauncherShellConfig } from "../../../shared/launcher"
import {
  getLauncherHistoryDedupeKeyForAction,
  sortLauncherHistoryItems,
  type LauncherHistoryItem
} from "../../../shared/launcher-history"
import type { LauncherSearchResult } from "../../../shared/launcher-search"
import type { LocalStartItem } from "../../../shared/local-start"
import { shouldShowLauncherIdleItems } from "../../../shared/launcher-settings"
import { getLauncherPluginIntents } from "./pages"
import {
  buildLauncherHistoryShellItems,
  buildLauncherLocalStartShellItems,
  buildLauncherPluginIntentShellItems,
  buildLauncherSearchShellItems
} from "./search-items"
import type { LauncherShellItem } from "./types"

export type LauncherHomeSurfaceMode = "history" | "idle" | "results"

export type LauncherHomeSurfaceSectionKind =
  | "history-grid"
  | "idle-list"
  | "plugin-intents"
  | "search-results"

export interface LauncherHomeSurfaceSection {
  items: LauncherShellItem[]
  kind: LauncherHomeSurfaceSectionKind
}

export interface LauncherHomeSurfaceModel {
  items: LauncherShellItem[]
  mode: LauncherHomeSurfaceMode
  sections: LauncherHomeSurfaceSection[]
  selection: {
    defaultStrategy: "first-item" | "none"
  }
}

function createHomeSurfaceModel(
  mode: LauncherHomeSurfaceMode,
  sections: LauncherHomeSurfaceSection[]
): LauncherHomeSurfaceModel {
  const items = sections.flatMap((section) => section.items)

  return {
    items,
    mode,
    sections,
    selection: {
      defaultStrategy: items.length > 0 ? "first-item" : "none"
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
  const historyByDedupeKey = new Map(historyItems.map((item) => [item.dedupeKey, item]))

  return searchResults
    .map((result, index) => ({
      history: historyByDedupeKey.get(getLauncherHistoryDedupeKeyForAction(result.action) ?? ""),
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
      return createHomeSurfaceModel("idle", [])
    }

    if (historyItems.length > 0) {
      const rankedHistoryItems = rankHistorySectionItems(historyItems)
      return createHomeSurfaceModel("history", [
        {
          items: buildLauncherHistoryShellItems(copy, rankedHistoryItems),
          kind: "history-grid"
        }
      ])
    }

    return createHomeSurfaceModel("idle", [
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

  return createHomeSurfaceModel("results", sections)
}

export function getLauncherHomeSurfaceResultsHeight(
  surface: LauncherHomeSurfaceModel,
  shellConfig: LauncherShellConfig
): number {
  if (surface.mode === "history") {
    const columns = 8
    const rows = Math.ceil(surface.items.length / columns)
    return rows * 70
  }

  return getLauncherResultsHeight(surface.items.length, shellConfig)
}
