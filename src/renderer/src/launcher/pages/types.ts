import type { ComponentType } from "react"
import type { AppLocale } from "../../../../shared/i18n"
import type { LauncherResultKind, LauncherShellConfig } from "../../../../shared/launcher"
import type { AppCopy } from "@/lib/i18n/messages"

export type LauncherPluginId = "ai" | (string & {})
export type LauncherNavigationDirection = "forward" | "backward"

export interface LauncherPluginRoute {
  id: LauncherPluginId
  seedQuery: string
}

export type LauncherRoute = { id: "home" } | LauncherPluginRoute

export interface LauncherPluginOpenOptions {
  seedQuery?: string
}

export interface LauncherHomeEntry {
  pluginId: LauncherPluginId
  label: string
  shortcutLabel?: string
}

export interface LauncherPluginIntent {
  id: string
  kind: LauncherResultKind
  openOptions?: LauncherPluginOpenOptions
  priority?: number
  subtitle: string
  title: string
}

export interface LauncherPluginCommandMatch {
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

export interface LauncherPluginDefinition {
  buildHomeEntry?: (context: LauncherPluginTextContext) => LauncherHomeEntry
  buildIntentItems?: (params: {
    copy: AppCopy
    locale: AppLocale
    query: string
  }) => LauncherPluginIntent[]
  getViewportHeight: (shellConfig: LauncherShellConfig) => number
  id: LauncherPluginId
  Component: ComponentType
  resolveCommand?: (params: LauncherPluginCommandParams) => LauncherPluginCommandMatch | null
}

export function isLauncherPluginRoute(route: LauncherRoute): route is LauncherPluginRoute {
  return "seedQuery" in route
}
