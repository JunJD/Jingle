import { createElement, type ReactElement, type ReactNode } from "react"
import { ExtensionHostActionKind, ExtensionHostElement } from "./host-elements"
import { useNativeExtensionNavigation } from "./context"
import type { RuntimeKeyboardShortcut } from "./keyboard"
import { createVisualElement, type IconLike } from "./visual"

export type RuntimeActionStyle = "destructive" | "regular"
type RuntimeActionHandler = () => Promise<unknown> | unknown
export type RuntimeClipboardContent =
  | string
  | {
      html?: string
      text?: string
    }

export interface RuntimeActionPanelProps {
  children?: ReactNode
}

export interface RuntimeActionPanelSectionProps {
  children?: ReactNode
  icon?: IconLike
  shortcut?: RuntimeKeyboardShortcut
  title?: string
}

export interface RuntimeActionProps {
  disabled?: boolean
  icon?: IconLike
  onAction?: RuntimeActionHandler
  shortcut?: RuntimeKeyboardShortcut
  style?: RuntimeActionStyle
  title: string
}

export type RuntimeSubmitFormValues = Record<string, import("./form").Form.Value>

export interface RuntimeSubmitFormActionProps extends RuntimeActionProps {
  onSubmit?: {
    bivarianceHack(values: RuntimeSubmitFormValues): Promise<void> | void
  }["bivarianceHack"]
}

export interface RuntimeCopyToClipboardActionProps {
  content: RuntimeClipboardContent
  disabled?: boolean
  icon?: IconLike
  shortcut?: RuntimeKeyboardShortcut
  style?: RuntimeActionStyle
  title?: string
}

export interface RuntimePasteActionProps {
  content: RuntimeClipboardContent
  disabled?: boolean
  icon?: IconLike
  shortcut?: RuntimeKeyboardShortcut
  style?: RuntimeActionStyle
  title?: string
}

export interface RuntimeOpenInBrowserActionProps {
  disabled?: boolean
  icon?: IconLike
  shortcut?: RuntimeKeyboardShortcut
  style?: RuntimeActionStyle
  title?: string
  url: string
}

export interface RuntimePushActionProps {
  disabled?: boolean
  icon?: IconLike
  shortcut?: RuntimeKeyboardShortcut
  style?: RuntimeActionStyle
  target: ReactNode
  title: string
}

export interface RuntimeCreateQuicklinkActionQuicklink {
  link: string
  name?: string
}

export interface RuntimeCreateQuicklinkActionShortcut {
  macOS?: {
    key: string
    modifiers: string[]
  }
  Windows?: {
    key: string
    modifiers: string[]
  }
}

export interface RuntimeCreateQuicklinkActionProps {
  disabled?: boolean
  icon?: IconLike
  quicklink: RuntimeCreateQuicklinkActionQuicklink
  shortcut?: RuntimeCreateQuicklinkActionShortcut
  style?: RuntimeActionStyle
  title?: string
}

type RuntimeActionPanelComponent = ((props: RuntimeActionPanelProps) => ReactElement) & {
  Section: (props: RuntimeActionPanelSectionProps) => ReactElement
  Submenu: (props: RuntimeActionPanelSectionProps) => ReactElement
}

type RuntimeActionComponent = ((props: RuntimeActionProps) => ReactElement) & {
  CopyToClipboard: (props: RuntimeCopyToClipboardActionProps) => ReactElement
  CreateQuicklink: (props: RuntimeCreateQuicklinkActionProps) => ReactElement
  OpenInBrowser: (props: RuntimeOpenInBrowserActionProps) => ReactElement
  Paste: (props: RuntimePasteActionProps) => ReactElement
  Push: (props: RuntimePushActionProps) => ReactElement
  SubmitForm: (props: RuntimeSubmitFormActionProps) => ReactElement
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

function PasteAction(props: RuntimePasteActionProps): ReactElement {
  const { icon, title = "Paste", ...hostProps } = props
  return createElement(
    ExtensionHostElement.Action,
    {
      actionKind: ExtensionHostActionKind.Paste,
      ...hostProps,
      title
    },
    createVisualElement("icon", icon)
  )
}

function CreateQuicklinkAction(props: RuntimeCreateQuicklinkActionProps): ReactElement {
  const { icon, quicklink, title = "Create Quicklink", ...hostProps } = props
  return createElement(
    ExtensionHostElement.Action,
    {
      actionKind: ExtensionHostActionKind.CreateQuicklink,
      quicklink,
      ...hostProps,
      title
    },
    createVisualElement("icon", icon)
  )
}

function PushAction(props: RuntimePushActionProps): ReactElement {
  const { target, ...actionProps } = props
  const navigation = useNativeExtensionNavigation()

  return createElement(ActionRoot, {
    ...actionProps,
    onAction: () => navigation.push(target)
  })
}

function SubmitFormAction(props: RuntimeSubmitFormActionProps): ReactElement {
  const { icon, onAction, onSubmit, ...hostProps } = props
  return createElement(
    ExtensionHostElement.Action,
    {
      actionKind: ExtensionHostActionKind.SubmitForm,
      ...hostProps,
      onAction,
      onSubmit
    },
    createVisualElement("icon", icon)
  )
}

export const ActionPanel: RuntimeActionPanelComponent = Object.assign(ActionPanelRoot, {
  Section: ActionPanelSection,
  Submenu: ActionPanelSubmenu
})

export const Action: RuntimeActionComponent = Object.assign(ActionRoot, {
  CopyToClipboard: CopyToClipboardAction,
  CreateQuicklink: CreateQuicklinkAction,
  OpenInBrowser: OpenInBrowserAction,
  Paste: PasteAction,
  Push: PushAction,
  SubmitForm: SubmitFormAction,
  Style: {
    Destructive: "destructive",
    Regular: "regular"
  } satisfies RuntimeActionComponent["Style"]
})

export namespace Action {
  export type CopyToClipboard = RuntimeCopyToClipboardActionProps
  export type Paste = RuntimePasteActionProps

  export namespace CreateQuicklink {
    export type Props = RuntimeCreateQuicklinkActionProps
  }
}
