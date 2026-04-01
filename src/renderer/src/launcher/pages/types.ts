import type { ComponentType } from "react"
import type { AppLocale } from "../../../../shared/i18n"
import type { LauncherShellConfig } from "../../../../shared/launcher"
import type {
  LauncherPluginCommandMode as SharedLauncherPluginCommandMode,
  LauncherPluginManifest as SharedLauncherPluginManifest
} from "../../../../shared/launcher-plugin"
import type { AppCopy } from "@/lib/i18n/messages"
import type { LauncherResultPresentation, LauncherShellItemKind } from "../result-types"

export type LauncherPluginId = string & {}
export type LauncherPluginCommandName = string & {}
export type LauncherExternalExtensionName = string & {}
export type LauncherNavigationDirection = "forward" | "backward"

export interface LauncherInternalPluginCommandAddress {
  kind: "internal-plugin"
  commandName: LauncherPluginCommandName
  pluginId: LauncherPluginId
}

export interface LauncherExternalExtensionCommandAddress {
  kind: "external-extension"
  commandName: string
  extensionName: LauncherExternalExtensionName
}

export type LauncherCommandAddress =
  | LauncherInternalPluginCommandAddress
  | LauncherExternalExtensionCommandAddress

export type LauncherPluginCommandAddress = LauncherInternalPluginCommandAddress

export interface LauncherPluginRoute extends LauncherInternalPluginCommandAddress {
  initialAction: LauncherPluginCommandInitialAction
  seedQuery: string
}

export interface LauncherExternalExtensionCommandRoute extends LauncherExternalExtensionCommandAddress {
  initialAction: LauncherPluginCommandInitialAction
  seedQuery: string
}

export type LauncherRoute =
  | { id: "home" }
  | LauncherPluginRoute
  | LauncherExternalExtensionCommandRoute

export type LauncherPluginCommandInitialAction = "focus" | "submit"

export interface LauncherPluginNavigation {
  goHome: () => void
  hideLauncher: () => Promise<void>
  openCommand: (address: LauncherCommandAddress, options?: LauncherPluginOpenOptions) => void
}

export interface LauncherPluginOpenOptions {
  initialAction?: LauncherPluginCommandInitialAction
  seedQuery?: string
}

export interface LauncherPluginIntent {
  commandName?: LauncherPluginCommandName
  id: string
  kind: LauncherShellItemKind
  openOptions?: LauncherPluginOpenOptions
  presentation: LauncherResultPresentation
  priority?: number
  subtitle: string
  title: string
}

export interface LauncherResolvedPluginIntent extends Omit<LauncherPluginIntent, "commandName"> {
  commandName: LauncherPluginCommandName
  pluginId: LauncherPluginId
}

export interface LauncherPluginCommandMatch {
  commandName?: LauncherPluginCommandName
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

export type LauncherPluginManifest = SharedLauncherPluginManifest<
  LauncherPluginId,
  LauncherPluginCommandName
>

export type LauncherPluginCommandMode = SharedLauncherPluginCommandMode

interface LauncherPluginSearchDefinition {
  buildIntentItems?: (params: {
    copy: AppCopy
    locale: AppLocale
    query: string
  }) => LauncherPluginIntent[]
  commandName: LauncherPluginCommandName
  resolveCommand?: (params: LauncherPluginCommandParams) => LauncherPluginCommandMatch | null
}

export interface LauncherNoViewPluginRunContext {
  initialAction: LauncherPluginCommandInitialAction
  navigation?: LauncherPluginNavigation
  seedQuery: string
}

export interface LauncherViewPluginCommandDefinition extends LauncherPluginSearchDefinition {
  Component: ComponentType
  getViewportHeight: (shellConfig: LauncherShellConfig) => number
  mode: "view"
}

export interface LauncherNoViewPluginCommandDefinition extends LauncherPluginSearchDefinition {
  mode: "no-view"
  run: (context: LauncherNoViewPluginRunContext) => Promise<void> | void
}

export type LauncherPluginCommandDefinition =
  | LauncherViewPluginCommandDefinition
  | LauncherNoViewPluginCommandDefinition

export function isLauncherViewPluginCommand(
  command: LauncherPluginCommandDefinition
): command is LauncherViewPluginCommandDefinition {
  return command.mode === "view"
}

export function isLauncherNoViewPluginCommand(
  command: LauncherPluginCommandDefinition
): command is LauncherNoViewPluginCommandDefinition {
  return command.mode === "no-view"
}

export interface LauncherPluginDefinition {
  commands: LauncherPluginCommandDefinition[]
  manifest: LauncherPluginManifest
}

export function isLauncherPluginRoute(route: LauncherRoute): route is LauncherPluginRoute {
  return "kind" in route && route.kind === "internal-plugin"
}

export function isLauncherExternalExtensionRoute(
  route: LauncherRoute
): route is LauncherExternalExtensionCommandRoute {
  return "kind" in route && route.kind === "external-extension"
}

export function isLauncherCommandRoute(
  route: LauncherRoute
): route is LauncherPluginRoute | LauncherExternalExtensionCommandRoute {
  return "kind" in route
}
