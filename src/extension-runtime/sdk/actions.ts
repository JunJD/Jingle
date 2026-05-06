import { createElement, type ReactElement, type ReactNode } from "react"
import { ExtensionHostActionKind, ExtensionHostElement } from "./host-elements"

export type RuntimeActionStyle = "destructive" | "regular"

export interface RuntimeActionPanelProps {
  children?: ReactNode
}

export interface RuntimeActionPanelSectionProps {
  children?: ReactNode
  title?: string
}

export interface RuntimeActionProps {
  disabled?: boolean
  icon?: ReactNode
  onAction?: () => Promise<void> | void
  style?: RuntimeActionStyle
  title: string
}

export interface RuntimeCopyToClipboardActionProps {
  content: string
  disabled?: boolean
  icon?: ReactNode
  style?: RuntimeActionStyle
  title?: string
}

export interface RuntimeOpenInBrowserActionProps {
  disabled?: boolean
  icon?: ReactNode
  style?: RuntimeActionStyle
  title?: string
  url: string
}

type RuntimeActionPanelComponent = ((props: RuntimeActionPanelProps) => ReactElement) & {
  Section: (props: RuntimeActionPanelSectionProps) => ReactElement
  Submenu: (props: RuntimeActionPanelSectionProps) => ReactElement
}

type RuntimeActionComponent = ((props: RuntimeActionProps) => ReactElement) & {
  CopyToClipboard: (props: RuntimeCopyToClipboardActionProps) => ReactElement
  OpenInBrowser: (props: RuntimeOpenInBrowserActionProps) => ReactElement
  SubmitForm: (props: RuntimeActionProps) => ReactElement
  Style: {
    Destructive: RuntimeActionStyle
    Regular: RuntimeActionStyle
  }
}

function ActionPanelRoot(props: RuntimeActionPanelProps): ReactElement {
  return createElement(ExtensionHostElement.ActionPanel, null, props.children)
}

function ActionPanelSection(props: RuntimeActionPanelSectionProps): ReactElement {
  const { children, ...hostProps } = props
  return createElement(ExtensionHostElement.ActionPanelSection, hostProps, children)
}

function ActionPanelSubmenu(props: RuntimeActionPanelSectionProps): ReactElement {
  const { children, ...hostProps } = props
  return createElement(ExtensionHostElement.ActionPanelSubmenu, hostProps, children)
}

function ActionRoot(props: RuntimeActionProps): ReactElement {
  const { icon, ...hostProps } = props
  return createElement(ExtensionHostElement.Action, hostProps, createVisualElement("icon", icon))
}

function CopyToClipboardAction(props: RuntimeCopyToClipboardActionProps): ReactElement {
  const { icon, title = "Copy to Clipboard", ...hostProps } = props
  return createElement(
    ExtensionHostElement.Action,
    {
      actionKind: ExtensionHostActionKind.CopyToClipboard,
      ...hostProps,
      title
    },
    createVisualElement("icon", icon)
  )
}

function OpenInBrowserAction(props: RuntimeOpenInBrowserActionProps): ReactElement {
  const { icon, title = "Open in Browser", ...hostProps } = props
  return createElement(
    ExtensionHostElement.Action,
    {
      actionKind: ExtensionHostActionKind.OpenInBrowser,
      ...hostProps,
      title
    },
    createVisualElement("icon", icon)
  )
}

function createVisualElement(slot: string, node: ReactNode): ReactElement | null {
  if (node === null || node === undefined || typeof node === "boolean") {
    return null
  }

  return createElement(ExtensionHostElement.Visual, { slot }, node)
}

export const ActionPanel: RuntimeActionPanelComponent = Object.assign(ActionPanelRoot, {
  Section: ActionPanelSection,
  Submenu: ActionPanelSubmenu
})

export const Action: RuntimeActionComponent = Object.assign(ActionRoot, {
  CopyToClipboard: CopyToClipboardAction,
  OpenInBrowser: OpenInBrowserAction,
  SubmitForm: ActionRoot,
  Style: {
    Destructive: "destructive",
    Regular: "regular"
  } satisfies RuntimeActionComponent["Style"]
})
