import type { ComponentType, RefObject } from "react"

export type LauncherFeaturePageId = "ai"
export type LauncherNavigationDirection = "forward" | "backward"

export type LauncherRoute =
  | { id: "home" }
  | {
      id: LauncherFeaturePageId
      seedQuery: string
    }

export interface LauncherFeaturePageRenderProps {
  inputRef: RefObject<HTMLInputElement | null>
  onBack: () => void
  onViewportHeightChange: (height: number) => void
  seedQuery: string
}

export interface LauncherHomeEntry {
  pageId: LauncherFeaturePageId
  label: string
  shortcutLabel: string
}

export interface LauncherFeaturePageDefinition {
  id: LauncherFeaturePageId
  Component: ComponentType<LauncherFeaturePageRenderProps>
}
