import type { AppCopy } from "@/lib/i18n/messages"
import type { AppLocale } from "../../../shared/i18n"
import { getLauncherResultsHeight, type LauncherShellConfig } from "../../../shared/launcher"
import type { LauncherHistoryItem } from "../../../shared/launcher-history"
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
      return createHomeSurfaceModel("history", [
        {
          items: buildLauncherHistoryShellItems(copy, historyItems),
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
  const searchResultItems = buildLauncherSearchShellItems(copy, searchResults)

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
