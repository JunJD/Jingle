import type { ComponentType } from "react"
import type { AppLocale } from "../../../../shared/i18n"
import type { LauncherShellConfig } from "../../../../shared/launcher"
import type { LauncherPluginManifest as SharedLauncherPluginManifest } from "../../../../shared/launcher-plugin"
import type { AppCopy } from "@/lib/i18n/messages"
import type { LauncherResultPresentation, LauncherShellItemKind } from "../result-types"

export type LauncherPluginId = string & {}
export type LauncherPluginEntryId = string & {}
export type LauncherNavigationDirection = "forward" | "backward"

export interface LauncherPluginEntryAddress {
  entryId: LauncherPluginEntryId
  pluginId: LauncherPluginId
}

export interface LauncherPluginRoute extends LauncherPluginEntryAddress {
  initialAction: LauncherPluginEntryInitialAction
  seedQuery: string
}

export type LauncherRoute = { id: "home" } | LauncherPluginRoute

export type LauncherPluginEntryInitialAction = "focus" | "submit"

export interface LauncherPluginOpenOptions {
  initialAction?: LauncherPluginEntryInitialAction
  seedQuery?: string
}

export interface LauncherHomeEntry extends LauncherPluginEntryAddress {
  label: string
  shortcutLabel?: string
}

export interface LauncherPluginIntent {
  entryId?: LauncherPluginEntryId
  id: string
  kind: LauncherShellItemKind
  openOptions?: LauncherPluginOpenOptions
  presentation: LauncherResultPresentation
  priority?: number
  subtitle: string
  title: string
}

export interface LauncherResolvedPluginIntent extends Omit<LauncherPluginIntent, "entryId"> {
  entryId: LauncherPluginEntryId
  pluginId: LauncherPluginId
}

export interface LauncherPluginCommandMatch {
  entryId?: LauncherPluginEntryId
  openOptions?: LauncherPluginOpenOptions
}

export interface LauncherPluginCommandParams {
  altKey: boolean
  ctrlKey: boolean
  key: string
  metaKey: boolean
  query: string
  shiftKey: boolean
}

export interface LauncherPluginTextContext {
  copy: AppCopy
  locale: AppLocale
}

export type LauncherPluginManifest = SharedLauncherPluginManifest<
  LauncherPluginId,
  LauncherPluginEntryId
>

export interface LauncherPluginEntryDefinition {
  buildHomeEntry?: (
    context: LauncherPluginTextContext
  ) => Omit<LauncherHomeEntry, "entryId" | "pluginId">
  buildIntentItems?: (params: {
    copy: AppCopy
    locale: AppLocale
    query: string
  }) => LauncherPluginIntent[]
  entryId: LauncherPluginEntryId
  getViewportHeight: (shellConfig: LauncherShellConfig) => number
  Component: ComponentType
  resolveCommand?: (params: LauncherPluginCommandParams) => LauncherPluginCommandMatch | null
}

export interface LauncherPluginDefinition {
  entries: LauncherPluginEntryDefinition[]
  manifest: LauncherPluginManifest
}

export function isLauncherPluginRoute(route: LauncherRoute): route is LauncherPluginRoute {
  return "pluginId" in route
}
