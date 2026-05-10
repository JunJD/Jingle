import { createElement, type ReactElement, type ReactNode } from "react"
import type { NativeMenuBarIconName } from "../../shared/native-menu-bar"
import { ExtensionHostElement } from "./host-elements"

export interface RuntimeMenuBarExtraProps {
  children?: ReactNode
  iconName?: NativeMenuBarIconName
  isLoading?: boolean
  title?: string
  tooltip?: string
}

export interface RuntimeMenuBarExtraSectionProps {
  children?: ReactNode
  title?: string
}

export interface RuntimeMenuBarExtraItemProps {
  disabled?: boolean
  iconName?: NativeMenuBarIconName
  onAction?: () => Promise<void> | void
  subtitle?: string
  title: string
}

type RuntimeMenuBarExtraComponent = ((props: RuntimeMenuBarExtraProps) => ReactElement) & {
  Item: (props: RuntimeMenuBarExtraItemProps) => ReactElement
  Section: (props: RuntimeMenuBarExtraSectionProps) => ReactElement
}

function MenuBarExtraRoot(props: RuntimeMenuBarExtraProps): ReactElement {
  const { children, ...hostProps } = props
  return createElement(ExtensionHostElement.MenuBarExtra, hostProps, children)
}

function MenuBarExtraSection(props: RuntimeMenuBarExtraSectionProps): ReactElement {
  const { children, ...hostProps } = props
  return createElement(ExtensionHostElement.MenuBarExtraSection, hostProps, children)
}

function MenuBarExtraItem(props: RuntimeMenuBarExtraItemProps): ReactElement {
  return createElement(ExtensionHostElement.MenuBarExtraItem, props)
}

export const MenuBarExtra: RuntimeMenuBarExtraComponent = Object.assign(MenuBarExtraRoot, {
  Item: MenuBarExtraItem,
  Section: MenuBarExtraSection
})
