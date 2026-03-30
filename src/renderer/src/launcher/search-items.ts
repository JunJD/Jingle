import type { AppCopy } from "@/lib/i18n/messages"
import type { LauncherHistoryItem } from "../../../shared/launcher-history"
import type { LocalStartItem } from "../../../shared/local-start"
import type { LauncherSearchResult } from "../../../shared/launcher-search"
import type { LauncherResolvedPluginIntent } from "./pages/types"
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

export function buildLauncherPluginIntentShellItems(
  items: LauncherResolvedPluginIntent[]
): LauncherShellItem[] {
  return items.map((item) => ({
    action: {
      executor: "internal",
      target: null,
      type: "none"
    },
    id: item.id,
    kind: item.kind,
    pluginEntryId: item.entryId,
    pluginId: item.pluginId,
    pluginOpenOptions: item.openOptions,
    presentation: item.presentation,
    subtitle: item.subtitle,
    title: item.title
  }))
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
