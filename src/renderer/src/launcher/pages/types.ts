import type { ReactNode } from "react"
import type { LauncherShellConfig } from "../../../../shared/launcher"

export type LauncherSecondaryPageId = "ai"
export type LauncherNavigationDirection = "forward" | "backward"

export interface LauncherSecondaryPageBodyProps {
  query: string
}

export interface LauncherSecondaryPageEntryConfig {
  label: string
  shortcutLabel: string
}

export interface LauncherSecondaryPageFooterConfig {
  leadingLabel: string
  primaryLabel: string
  primaryShortcutLabel: string
}

export interface LauncherSecondaryPageDefinition {
  id: LauncherSecondaryPageId
  title: string
  inputPlaceholder: string
  closeOnEmptyBackspace: boolean
  entry: LauncherSecondaryPageEntryConfig
  footer: LauncherSecondaryPageFooterConfig
  getViewportHeight: (shellConfig: LauncherShellConfig) => number
  renderBody: (props: LauncherSecondaryPageBodyProps) => ReactNode
}
