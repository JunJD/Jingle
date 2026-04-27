export type NativeMenuBarIconName =
  | "bell"
  | "check"
  | "gear"
  | "github"
  | "openwork"
  | "plus"
  | "refresh"
  | "reminder-item"
  | "reminders"
  | "todo"

export interface NativeMenuBarItemState {
  disabled?: boolean
  iconName?: NativeMenuBarIconName
  id: string
  subtitle?: string
  title: string
}

export interface NativeMenuBarSectionState {
  items: NativeMenuBarItemState[]
  title?: string
}

export interface NativeMenuBarState {
  commandKey: string
  iconName?: NativeMenuBarIconName
  isLoading?: boolean
  sections: NativeMenuBarSectionState[]
  title?: string
  tooltip?: string
}

export interface NativeMenuBarActionEvent {
  commandKey: string
  itemId: string
}
