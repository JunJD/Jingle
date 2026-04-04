import { Children, isValidElement, useEffect, useMemo, type ReactNode } from "react"
import type { NativeMenuBarState } from "@shared/native-menu-bar"
import { useNativeExtensionHost } from "./sdk"

type MenuBarMarkerRole = "menu-bar-item" | "menu-bar-section"

interface MenuBarMarkerComponent<P = object> extends React.FC<P> {
  __menuBarRole: MenuBarMarkerRole
}

function createMenuBarMarkerComponent<P = object>(
  role: MenuBarMarkerRole
): MenuBarMarkerComponent<P> {
  const Component = (() => null) as unknown as MenuBarMarkerComponent<P>
  Component.__menuBarRole = role
  return Component
}

const MenuBarSectionMarker = createMenuBarMarkerComponent<{
  children?: ReactNode
  title?: string
}>("menu-bar-section")

const MenuBarItemMarker = createMenuBarMarkerComponent<{
  disabled?: boolean
  onAction?: () => void | Promise<void>
  subtitle?: string
  title: string
}>("menu-bar-item")

interface MenuBarActionDescriptor {
  disabled?: boolean
  id: string
  onAction: () => void | Promise<void>
  subtitle?: string
  title: string
}

function extractMenuBarRole(node: ReactNode): MenuBarMarkerRole | null {
  if (!isValidElement(node)) {
    return null
  }

  const marker = node.type as MenuBarMarkerComponent
  return marker.__menuBarRole ?? null
}

function collectMenuBarSections(children: ReactNode): {
  actionMap: Map<string, MenuBarActionDescriptor>
  stateSections: NativeMenuBarState["sections"]
} {
  let actionCounter = 0
  const actionMap = new Map<string, MenuBarActionDescriptor>()

  const toItemState = (node: ReactNode) => {
    if (!isValidElement(node) || extractMenuBarRole(node) !== "menu-bar-item") {
      return null
    }

    const props = node.props as {
      disabled?: boolean
      onAction?: () => void | Promise<void>
      subtitle?: string
      title: string
    }
    if (!props.onAction) {
      return null
    }

    const id = `menu-bar-item-${actionCounter++}`
    actionMap.set(id, {
      disabled: props.disabled,
      id,
      onAction: props.onAction,
      subtitle: props.subtitle,
      title: props.title
    })

    return {
      disabled: props.disabled,
      id,
      subtitle: props.subtitle,
      title: props.title
    }
  }

  const topLevelNodes = Children.toArray(children)
  const implicitItems = topLevelNodes
    .map((node) => toItemState(node))
    .filter((item): item is NonNullable<ReturnType<typeof toItemState>> => item !== null)

  const stateSections = topLevelNodes
    .map((node) => {
      if (!isValidElement(node) || extractMenuBarRole(node) !== "menu-bar-section") {
        return null
      }

      const props = node.props as { children?: ReactNode; title?: string }
      const items = Children.toArray(props.children)
        .map((child) => toItemState(child))
        .filter((item): item is NonNullable<ReturnType<typeof toItemState>> => item !== null)

      if (items.length === 0) {
        return null
      }

      return {
        items,
        title: props.title
      }
    })
    .filter((section): section is NonNullable<(typeof stateSections)[number]> => section !== null)

  if (implicitItems.length > 0) {
    stateSections.unshift({
      items: implicitItems
    })
  }

  return {
    actionMap,
    stateSections
  }
}

function MenuBarRoot(props: {
  children?: ReactNode
  isLoading?: boolean
  title?: string
  tooltip?: string
}): null {
  const { children, isLoading = false, title, tooltip } = props
  const host = useNativeExtensionHost()
  const commandKey = `${host.extensionName}:${host.commandName}`
  const descriptor = useMemo(() => collectMenuBarSections(children), [children])

  useEffect(() => {
    void window.api.nativeMenuBar.setState({
      commandKey,
      isLoading,
      sections: descriptor.stateSections,
      title,
      tooltip
    })

    return () => {
      void window.api.nativeMenuBar.clearState(commandKey)
    }
  }, [commandKey, descriptor.stateSections, isLoading, title, tooltip])

  useEffect(() => {
    return window.api.nativeMenuBar.onItemSelected((event) => {
      if (event.commandKey !== commandKey) {
        return
      }

      const action = descriptor.actionMap.get(event.itemId)
      if (!action) {
        return
      }

      void Promise.resolve(action.onAction())
    })
  }, [commandKey, descriptor.actionMap])

  return null
}

export const MenuBarExtra = Object.assign(MenuBarRoot, {
  Item: MenuBarItemMarker,
  Section: MenuBarSectionMarker
})
