export type NativeMenuBarIconName =
  | "bell"
  | "check"
  | "gear"
  | "jingle"
  | "plus"
  | "refresh"

export interface NativeMenuBarExtensionIconState {
  extensionName: string
  path: string
}

export interface NativeMenuBarItemState {
  disabled?: boolean
  extensionIcon?: NativeMenuBarExtensionIconState
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
  extensionIcon?: NativeMenuBarExtensionIconState
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
