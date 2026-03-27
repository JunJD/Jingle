import type { AppCopy } from "@/lib/i18n/messages"
import type { LauncherHistoryItem } from "../../../shared/launcher-history"
import type { LocalStartItem } from "../../../shared/local-start"
import type { LauncherSearchResult } from "../../../shared/launcher-search"
import type { LauncherResolvedPluginIntent } from "./pages/types"
import { createLauncherBuiltinResultPresentation } from "./result-presentation"
import type { LauncherShellItem } from "./types"

export function buildLauncherSearchShellItems(
  copy: AppCopy,
  searchResults: LauncherSearchResult[]
): LauncherShellItem[] {
  return searchResults.map((result) => ({
    action: result.action,
    availability: result.availability,
    id: result.id,
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
      type: "open-local-start-item",
      itemId: item.id,
      itemKind: item.kind,
      path: item.path
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
    kind: item.kind,
    presentation: createLauncherBuiltinResultPresentation({
      copy,
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
    action: { type: "none" },
    id: item.id,
    kind: item.kind,
    pluginEntryId: item.entryId,
    pluginId: item.pluginId,
    pluginOpenOptions: item.openOptions,
    presentation: item.presentation,
    priority: item.priority,
    subtitle: item.subtitle,
    title: item.title
  }))
}
