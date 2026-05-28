import type { ReactNode } from "react"

export type LauncherActionStyle = "regular" | "destructive"

export interface LauncherActionDescriptor {
  disabled?: boolean
  icon?: ReactNode
  id: string
  onAction: () => void | Promise<void>
  sectionTitle?: string
  shortcut?: string | null
  style?: LauncherActionStyle
  title: string
}

export interface LauncherActionController {
  actionPanelShortcut: string | null
  actions: LauncherActionDescriptor[]
  canOpenActions: boolean
  closeActions: () => void
  executePrimaryAction: () => void
  openActions: () => void
  primaryAction: LauncherActionDescriptor | null
  primaryActionFallbackTitle: string
  primaryActionShortcut: string | null
  showActions: boolean
}
