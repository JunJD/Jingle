import { Children, isValidElement, type ReactNode } from "react"

export type NativeActionStyle = "regular" | "destructive"

export interface NativeActionDescriptor {
  icon?: ReactNode
  id: string
  onAction: () => void | Promise<void>
  sectionTitle?: string
  shortcut?: string
  style?: NativeActionStyle
  title: string
}

type ActionMarkerRole =
  | "action-panel"
  | "action-panel-section"
  | "action-panel-submenu"
  | "action"
  | "action-open-in-browser"

interface ActionMarkerComponent<P = object> extends React.FC<P> {
  __nativeActionRole: ActionMarkerRole
}

function createActionMarkerComponent<P = object>(role: ActionMarkerRole): ActionMarkerComponent<P> {
  const Component = (() => null) as unknown as ActionMarkerComponent<P>
  Component.__nativeActionRole = role
  return Component
}

export const ActionPanelMarker = createActionMarkerComponent<{ children?: ReactNode }>(
  "action-panel"
)

export const ActionPanelSectionMarker = createActionMarkerComponent<{
  children?: ReactNode
  title?: string
}>("action-panel-section")

export const ActionPanelSubmenuMarker = createActionMarkerComponent<{
  children?: ReactNode
  title?: string
}>("action-panel-submenu")

export const ActionMarker = createActionMarkerComponent<{
  icon?: ReactNode
  onAction?: () => void | Promise<void>
  shortcut?: string
  style?: NativeActionStyle
  title: string
}>("action")

export const OpenInBrowserActionMarker = createActionMarkerComponent<{
  icon?: ReactNode
  shortcut?: string
  style?: NativeActionStyle
  title?: string
  url: string
}>("action-open-in-browser")

function extractActionMarkerRole(node: ReactNode): ActionMarkerRole | null {
  if (!isValidElement(node)) {
    return null
  }

  const marker = node.type as ActionMarkerComponent
  return marker.__nativeActionRole ?? null
}

export function collectActions(
  node: ReactNode,
  params: {
    nextId: () => string
    sectionTitle?: string
  }
): NativeActionDescriptor[] {
  const role = extractActionMarkerRole(node)
  if (!role || !isValidElement(node)) {
    return []
  }

  const nextSectionTitle =
    role === "action-panel-section" || role === "action-panel-submenu"
      ? ((node.props as { title?: string }).title ?? params.sectionTitle)
      : params.sectionTitle

  if (role === "action" || role === "action-open-in-browser") {
    const props = node.props as {
      icon?: ReactNode
      onAction?: () => void | Promise<void>
      shortcut?: string
      style?: NativeActionStyle
      title?: string
      url?: string
    }

    const title = props.title ?? (role === "action-open-in-browser" ? "Open in Browser" : "")
    if (!title) {
      return []
    }

    const onAction =
      role === "action-open-in-browser"
        ? () => {
            if (props.url) {
              window.open(props.url, "_blank", "noopener,noreferrer")
            }
          }
        : props.onAction

    if (!onAction) {
      return []
    }

    return [
      {
        icon: props.icon,
        id: params.nextId(),
        onAction,
        sectionTitle: nextSectionTitle,
        shortcut: props.shortcut,
        style: props.style,
        title
      }
    ]
  }

  const props = node.props as { children?: ReactNode }
  return Children.toArray(props.children).flatMap((child) =>
    collectActions(child, {
      nextId: params.nextId,
      sectionTitle: nextSectionTitle
    })
  )
}
