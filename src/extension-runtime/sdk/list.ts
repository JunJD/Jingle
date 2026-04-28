import { createElement, type ReactElement, type ReactNode } from "react"
import { ExtensionHostElement } from "./host-elements"

export interface RuntimeListProps {
  actions?: ReactNode
  children?: ReactNode
  filtering?: boolean
  isLoading?: boolean
  navigationTitle?: string
  onSearchTextChange?: (value: string) => Promise<void> | void
  searchBarAccessory?: ReactNode
  searchBarPlaceholder?: string
  searchText?: string
}

export interface RuntimeListSectionProps {
  children?: ReactNode
  subtitle?: string
  title?: string
}

export interface RuntimeListItemProps {
  accessories?: ReactNode
  actions?: ReactNode
  children?: ReactNode
  icon?: ReactNode
  id?: string
  keywords?: string[]
  subtitle?: string
  title: string
}

export interface RuntimeListEmptyViewProps {
  actions?: ReactNode
  description?: string
  title?: string
}

export interface RuntimeListDropdownProps {
  children?: ReactNode
  onChange?: (value: string) => Promise<void> | void
  value?: string
}

export interface RuntimeListDropdownSectionProps {
  children?: ReactNode
  title?: string
}

export interface RuntimeListDropdownItemProps {
  title: string
  value: string
}

type RuntimeListComponent = ((props: RuntimeListProps) => ReactElement) & {
  Dropdown: ((props: RuntimeListDropdownProps) => ReactElement) & {
    Item: (props: RuntimeListDropdownItemProps) => ReactElement
    Section: (props: RuntimeListDropdownSectionProps) => ReactElement
  }
  EmptyView: (props: RuntimeListEmptyViewProps) => ReactElement
  Item: (props: RuntimeListItemProps) => ReactElement
  Section: (props: RuntimeListSectionProps) => ReactElement
}

function ListRoot(props: RuntimeListProps): ReactElement {
  const { actions, children, searchBarAccessory, ...hostProps } = props
  return createElement(ExtensionHostElement.List, hostProps, actions, searchBarAccessory, children)
}

function ListSection(props: RuntimeListSectionProps): ReactElement {
  const { children, ...hostProps } = props
  return createElement(ExtensionHostElement.ListSection, hostProps, children)
}

function ListItem(props: RuntimeListItemProps): ReactElement {
  const { accessories, actions, children, icon, ...hostProps } = props
  return createElement(
    ExtensionHostElement.ListItem,
    hostProps,
    actions,
    createVisualElement("icon", icon),
    createVisualElement("accessory", accessories),
    children
  )
}

function ListEmptyView(props: RuntimeListEmptyViewProps): ReactElement {
  const { actions, ...hostProps } = props
  return createElement(ExtensionHostElement.ListEmptyView, hostProps, actions)
}

function ListDropdown(props: RuntimeListDropdownProps): ReactElement {
  const { children, ...hostProps } = props
  return createElement(ExtensionHostElement.ListDropdown, hostProps, children)
}

function ListDropdownSection(props: RuntimeListDropdownSectionProps): ReactElement {
  const { children, ...hostProps } = props
  return createElement(ExtensionHostElement.ListDropdownSection, hostProps, children)
}

function ListDropdownItem(props: RuntimeListDropdownItemProps): ReactElement {
  return createElement(ExtensionHostElement.ListDropdownItem, props)
}

function createVisualElement(slot: string, node: ReactNode): ReactElement | null {
  if (node === null || node === undefined || typeof node === "boolean") {
    return null
  }

  return createElement(ExtensionHostElement.Visual, { slot }, node)
}

export const List: RuntimeListComponent = Object.assign(ListRoot, {
  Dropdown: Object.assign(ListDropdown, {
    Item: ListDropdownItem,
    Section: ListDropdownSection
  }),
  EmptyView: ListEmptyView,
  Item: ListItem,
  Section: ListSection
})
