import type { ReactNode } from "react"
import type { ShortcutChord } from "@shared/shortcuts/model"

export type LauncherActionStyle = "regular" | "destructive"

export interface LauncherActionDescriptor {
  children?: LauncherActionDescriptor[]
  disabled?: boolean
  icon?: ReactNode
  id: string
  onAction: () => void | Promise<void>
  sectionTitle?: string
  shortcut?: string | null
  shortcutChord?: ShortcutChord
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
