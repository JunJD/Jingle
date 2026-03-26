import type { ComponentType, RefObject } from "react"
import type { LauncherShellConfig } from "../../../../shared/launcher"
import type { AppCopy } from "@/lib/i18n/messages"

export type LauncherPluginId = "ai"
export type LauncherNavigationDirection = "forward" | "backward"

export type LauncherRoute = { id: "home" } | { id: LauncherPluginId; seedQuery: string }

export interface LauncherPluginRenderProps {
  inputRef: RefObject<HTMLInputElement | null>
  onBack: () => void
  seedQuery: string
  shellConfig: LauncherShellConfig
}

export interface LauncherHomeEntry {
  pluginId: LauncherPluginId
  label: string
  shortcutLabel: string
}

export interface LauncherPluginDefinition {
  buildHomeEntry: (copy: AppCopy) => LauncherHomeEntry
  getViewportHeight: (shellConfig: LauncherShellConfig) => number
  id: LauncherPluginId
  Component: ComponentType<LauncherPluginRenderProps>
}
