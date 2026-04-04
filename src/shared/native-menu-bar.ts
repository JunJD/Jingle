export interface NativeMenuBarItemState {
  disabled?: boolean
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
  isLoading?: boolean
  sections: NativeMenuBarSectionState[]
  title?: string
  tooltip?: string
}

export interface NativeMenuBarActionEvent {
  commandKey: string
  itemId: string
}
