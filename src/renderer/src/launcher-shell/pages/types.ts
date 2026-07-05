import type { ComponentType } from "react"
import type {
  ExtensionRuntimeLaunchProps,
  ExtensionRuntimeToastRequestEvent
} from "@shared/extension-runtime-protocol"
import type { AppLocale } from "@shared/i18n"
import type { LauncherShellConfig } from "@shared/launcher"
import type {
  LauncherCommandArgumentManifest,
  LauncherCommandMode as SharedLauncherCommandMode,
  LauncherCommandOwnerManifest as SharedLauncherCommandOwnerManifest
} from "@shared/launcher-command-owner"
import type { AppCopy } from "../../lib/i18n/messages"
import type { LauncherResultPresentation, LauncherShellItemKind } from "../result-types"

export type LauncherBuiltInId = string & {}
export type LauncherExtensionName = string & {}
export type LauncherCommandName = string & {}
export type LauncherNavigationDirection = "forward" | "backward"

export interface LauncherBuiltInCommandAddress {
  builtInId: LauncherBuiltInId
  commandName: LauncherCommandName
  kind: "built-in-command"
}

export interface LauncherExtensionCommandAddress {
  commandName: LauncherCommandName
  extensionName: LauncherExtensionName
  kind: "extension-command"
}

export type LauncherCommandAddress = LauncherBuiltInCommandAddress | LauncherExtensionCommandAddress

export interface LauncherBuiltInCommandRoute extends LauncherBuiltInCommandAddress {
  initialAction: LauncherCommandInitialAction
  launchProps?: ExtensionRuntimeLaunchProps
  seedQuery: string
}

export interface LauncherExtensionCommandRoute extends LauncherExtensionCommandAddress {
  initialAction: LauncherCommandInitialAction
  launchProps?: ExtensionRuntimeLaunchProps
  seedQuery: string
}

export type LauncherCommandRoute = LauncherBuiltInCommandRoute | LauncherExtensionCommandRoute

export type LauncherRoute = { id: "home" } | LauncherCommandRoute

export type LauncherCommandInitialAction = "focus" | "submit"

export interface LauncherCommandNavigation {
  goHome: () => void
  hideLauncher: () => Promise<void>
  openCommand: (address: LauncherCommandAddress, options?: LauncherCommandOpenOptions) => void
}

export interface LauncherCommandOpenOptions {
  initialAction?: LauncherCommandInitialAction
  launchProps?: ExtensionRuntimeLaunchProps
  seedQuery?: string
}

export interface LauncherCommandIntent {
  commandName?: LauncherCommandName
  id: string
  kind: LauncherShellItemKind
  openOptions?: LauncherCommandOpenOptions
  presentation: LauncherResultPresentation
  priority?: number
  subtitle: string
  title: string
}

export interface LauncherResolvedCommandIntent extends Omit<LauncherCommandIntent, "commandName"> {
  address: LauncherCommandAddress
}

export interface LauncherCommandMatch {
  commandName?: LauncherCommandName
  openOptions?: LauncherCommandOpenOptions
}

export interface LauncherCommandParams {
  altKey: boolean
  ctrlKey: boolean
  key: string
  metaKey: boolean
  query: string
  shiftKey: boolean
}

export type LauncherBuiltInManifest = SharedLauncherCommandOwnerManifest<
  LauncherBuiltInId,
  LauncherCommandName
>

export type LauncherExtensionManifest = SharedLauncherCommandOwnerManifest<
  LauncherExtensionName,
  LauncherCommandName
>

export type LauncherCommandOwnerManifest = SharedLauncherCommandOwnerManifest<
  string,
  LauncherCommandName
>

export type LauncherCommandMode = SharedLauncherCommandMode

interface LauncherCommandSearchDefinition {
  arguments?: LauncherCommandArgumentManifest[]
  buildIntentItems?: (params: {
    copy: AppCopy
    locale: AppLocale
    query: string
  }) => LauncherCommandIntent[]
  commandName: LauncherCommandName
  loadCommandPreferences?: () => Promise<Record<string, unknown>>
  requiresLauncherArguments?: boolean
  requiresSearchArgument?: boolean
  validateCommandPreferences?: (
    preferences: Record<string, unknown>,
    locale: AppLocale
  ) => string | null
  resolveCommand?: (params: LauncherCommandParams) => LauncherCommandMatch | null
}

export interface LauncherNoViewCommandRunContext {
  commandPreferences: Record<string, unknown>
  initialAction: LauncherCommandInitialAction
  launchProps?: ExtensionRuntimeLaunchProps
  navigation?: LauncherCommandNavigation
  seedQuery: string
  showToast?: (event: ExtensionRuntimeToastRequestEvent) => void
}

export interface LauncherViewCommandDefinition extends LauncherCommandSearchDefinition {
  Component: ComponentType
  getViewportHeight: (shellConfig: LauncherShellConfig) => number
  mode: "view"
}

export interface LauncherNoViewCommandDefinition extends LauncherCommandSearchDefinition {
  mode: "no-view"
  run: (context: LauncherNoViewCommandRunContext) => Promise<void> | void
}

export type LauncherCommandDefinition =
  | LauncherViewCommandDefinition
  | LauncherNoViewCommandDefinition

export function isLauncherViewCommand(
  command: LauncherCommandDefinition
): command is LauncherViewCommandDefinition {
  return command.mode === "view"
}

export function isLauncherNoViewCommand(
  command: LauncherCommandDefinition
): command is LauncherNoViewCommandDefinition {
  return command.mode === "no-view"
}

export interface LauncherCommandOwnerDefinition {
  commands: LauncherCommandDefinition[]
  manifest: LauncherCommandOwnerManifest
}

export function isLauncherExtensionCommandAddress(
  address: LauncherCommandAddress
): address is LauncherExtensionCommandAddress {
  return address.kind === "extension-command"
}

export function isLauncherBuiltInCommandAddress(
  address: LauncherCommandAddress
): address is LauncherBuiltInCommandAddress {
  return address.kind === "built-in-command"
}

export function isLauncherExtensionCommandRoute(
  route: LauncherRoute
): route is LauncherExtensionCommandRoute {
  return "kind" in route && route.kind === "extension-command"
}

export function isLauncherCommandRoute(route: LauncherRoute): route is LauncherCommandRoute {
  return "kind" in route
}
