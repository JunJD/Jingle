import type { ComponentType, RefObject } from "react"
import type { LauncherShellConfig } from "../../../../shared/launcher"

export type LauncherFeaturePageId = "ai"
export type LauncherNavigationDirection = "forward" | "backward"

export type LauncherRoute = { id: "home" } | { id: LauncherFeaturePageId }

export interface LauncherFeaturePageRenderProps {
  inputRef: RefObject<HTMLInputElement | null>
  onBack: () => void
  shellConfig: LauncherShellConfig
}

export interface LauncherHomeEntry {
  pageId: LauncherFeaturePageId
  label: string
  shortcutLabel: string
}

export interface LauncherFeaturePageDefinition {
  getViewportHeight: (shellConfig: LauncherShellConfig) => number
  id: LauncherFeaturePageId
  Component: ComponentType<LauncherFeaturePageRenderProps>
}
