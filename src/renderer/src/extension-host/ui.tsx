import {
  Children,
  Fragment,
  isValidElement,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode
} from "react"
import { useShortcutCommandHandler, useShortcutScopeLayer } from "@/shortcuts/shortcut-context"
import { LauncherChrome } from "@launcher-components/LauncherChrome"
import { LAUNCHER_COMMAND_IDS } from "@shared/shortcuts/ids"
import {
  ActionMarker,
  ActionPanelMarker,
  ActionPanelSectionMarker,
  ActionPanelSubmenuMarker,
  collectActions,
  type NativeActionDescriptor,
  type NativeActionStyle,
  OpenInBrowserActionMarker
} from "./actions"
import {
  NativeSurfaceListEmptyState,
  NativeSurfaceListRows,
  nativeSurfaceListDropdownClassName,
  type NativeSurfaceListSectionPresentation
} from "./list-presentation"
import { useNativeSurfaceController } from "./surface-action-controller"
import { NativeExtensionSelect } from "./select"
import { useNativeExtensionSurface } from "./sdk"

const NATIVE_LIST_SHORTCUT_SCOPES = ["launcher.list"] as const

interface NativeListItemDescriptor {
  accessories?: ReactNode
  actions: NativeActionDescriptor[]
  icon?: ReactNode
  id: string
  keywords: string[]
  sectionTitle?: string
  subtitle?: string
  title: string
}

interface NativeListSectionDescriptor {
  id: string
  items: NativeListItemDescriptor[]
  subtitle?: string
  title?: string
}

interface NativeListEmptyViewDescriptor {
  actions: NativeActionDescriptor[]
  description?: string
  title?: string
}

interface NativeListDropdownItemDescriptor {
  title: string
  value: string
}

interface NativeListDropdownSectionDescriptor {
  items: NativeListDropdownItemDescriptor[]
  title?: string
}

interface NativeListDropdownDescriptor {
  onChange?: (value: string) => void
  sections: NativeListDropdownSectionDescriptor[]
  value?: string
}

type MarkerRole =
  | "list-section"
  | "list-item"
  | "list-empty-view"
  | "list-dropdown"
  | "list-dropdown-section"
  | "list-dropdown-item"

interface MarkerComponent<P = object> extends React.FC<P> {
  __nativeRole: MarkerRole
}

function createMarkerComponent<P = object>(role: MarkerRole): MarkerComponent<P> {
  const Component = (() => null) as unknown as MarkerComponent<P>
  Component.__nativeRole = role
  return Component
}

const ListSectionMarker = createMarkerComponent<{
  children?: ReactNode
  subtitle?: string
  title?: string
}>("list-section")

const ListItemMarker = createMarkerComponent<{
  accessories?: ReactNode
  actions?: ReactElement | null
  icon?: ReactNode
  id?: string
  keywords?: string[]
  subtitle?: string
  title: string
}>("list-item")

const ListEmptyViewMarker = createMarkerComponent<{
  actions?: ReactElement | null
  description?: string
  title?: string
}>("list-empty-view")

const ListDropdownMarker = createMarkerComponent<{
  children?: ReactNode
  onChange?: (value: string) => void
  value?: string
}>("list-dropdown")

const ListDropdownSectionMarker = createMarkerComponent<{
  children?: ReactNode
  title?: string
}>("list-dropdown-section")

const ListDropdownItemMarker = createMarkerComponent<{
  title: string
  value: string
}>("list-dropdown-item")

function extractMarkerRole(node: ReactNode): MarkerRole | null {
  if (!isValidElement(node)) {
    return null
  }

  const marker = node.type as MarkerComponent
  return marker.__nativeRole ?? null
}

function collectSections(children: ReactNode): NativeListSectionDescriptor[] {
  let itemCounter = 0
  let actionCounter = 0
  const nextItemId = (): string => `list-item-${itemCounter++}`
  const nextActionId = (): string => `list-action-${actionCounter++}`

  const topLevelNodes = Children.toArray(children)
  const sections: NativeListSectionDescriptor[] = []
  const implicitItems: NativeListItemDescriptor[] = []

  const toItemDescriptor = (
    node: ReactElement,
    sectionTitle?: string
  ): NativeListItemDescriptor | null => {
    if (extractMarkerRole(node) !== "list-item") {
      return null
    }

    const props = node.props as {
      accessories?: ReactNode
      actions?: ReactElement | null
      icon?: ReactNode
      id?: string
      keywords?: string[]
      subtitle?: string
      title: string
    }

    return {
      accessories: props.accessories,
      actions: props.actions
        ? collectActions(props.actions, {
            nextId: nextActionId
          })
        : [],
      icon: props.icon,
      id: props.id ?? nextItemId(),
      keywords: props.keywords ?? [],
      sectionTitle,
      subtitle: props.subtitle,
      title: props.title
    }
  }

  for (const node of topLevelNodes) {
    const role = extractMarkerRole(node)
    if (!role || !isValidElement(node)) {
      continue
    }

    if (role === "list-section") {
      const props = node.props as { children?: ReactNode; subtitle?: string; title?: string }
      const items = Children.toArray(props.children)
        .map((child) => (isValidElement(child) ? toItemDescriptor(child, props.title) : null))
        .filter((item): item is NativeListItemDescriptor => item !== null)

      sections.push({
        id: `list-section-${sections.length}`,
        items,
        subtitle: props.subtitle,
        title: props.title
      })
      continue
    }

    if (role === "list-item") {
      const item = toItemDescriptor(node)
      if (item) {
        implicitItems.push(item)
      }
    }
  }

  if (implicitItems.length > 0) {
    sections.unshift({
      id: "list-section-implicit",
      items: implicitItems
    })
  }

  return sections.filter((section) => section.items.length > 0)
}

function collectEmptyView(children: ReactNode): NativeListEmptyViewDescriptor | null {
  let actionCounter = 0
  const nextActionId = (): string => `list-empty-action-${actionCounter++}`

  for (const node of Children.toArray(children)) {
    if (!isValidElement(node) || extractMarkerRole(node) !== "list-empty-view") {
      continue
    }

    const props = node.props as {
      actions?: ReactElement | null
      description?: string
      title?: string
    }

    return {
      actions: props.actions
        ? collectActions(props.actions, {
            nextId: nextActionId
          })
        : [],
      description: props.description,
      title: props.title
    }
  }

  return null
}

function collectDropdown(children: ReactNode): NativeListDropdownDescriptor | null {
  for (const node of Children.toArray(children)) {
    if (!isValidElement(node) || extractMarkerRole(node) !== "list-dropdown") {
      continue
    }

    const props = node.props as {
      children?: ReactNode
      onChange?: (value: string) => void
      value?: string
    }

    const sections = Children.toArray(props.children)
      .map((sectionNode) => {
        if (!isValidElement(sectionNode)) {
          return null
        }

        const role = extractMarkerRole(sectionNode)
        if (role === "list-dropdown-item") {
          const itemProps = sectionNode.props as { title: string; value: string }
          return {
            items: [{ title: itemProps.title, value: itemProps.value }]
          } satisfies NativeListDropdownSectionDescriptor
        }

        if (role !== "list-dropdown-section") {
          return null
        }

        const sectionProps = sectionNode.props as { children?: ReactNode; title?: string }
        const items = Children.toArray(sectionProps.children)
          .map((itemNode) => {
            if (!isValidElement(itemNode) || extractMarkerRole(itemNode) !== "list-dropdown-item") {
              return null
            }

            const itemProps = itemNode.props as { title: string; value: string }
            return {
              title: itemProps.title,
              value: itemProps.value
            } satisfies NativeListDropdownItemDescriptor
          })
          .filter((item): item is NativeListDropdownItemDescriptor => item !== null)

        if (items.length === 0) {
          return null
        }

        return {
          items,
          title: sectionProps.title
        } satisfies NativeListDropdownSectionDescriptor
      })
      .filter((section): section is NativeListDropdownSectionDescriptor => section !== null)

    if (sections.length === 0) {
      return null
    }

    return {
      onChange: props.onChange,
      sections,
      value: props.value
    }
  }

  return null
}

function filterSections(
  sections: NativeListSectionDescriptor[],
  query: string
): NativeListSectionDescriptor[] {
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) {
    return sections
  }

  return sections.reduce<NativeListSectionDescriptor[]>((filteredSections, section) => {
    const items = section.items.filter((item) => {
      const haystacks = [item.title, item.subtitle ?? "", ...item.keywords]
        .join(" ")
        .toLowerCase()

      return haystacks.includes(normalizedQuery)
    })

    if (items.length > 0) {
      filteredSections.push({ ...section, items })
    }

    return filteredSections
  }, [])
}

function NativeListDropdown(props: {
  descriptor: NativeListDropdownDescriptor
}): React.JSX.Element {
  const { descriptor } = props
  const options = descriptor.sections.flatMap((section) =>
    section.items.map((item) => ({
      label: section.title ? `${section.title} · ${item.title}` : item.title,
      value: item.value
    }))
  )
  const selectedValue = descriptor.value ?? options[0]?.value ?? ""

  return (
    <NativeExtensionSelect
      className={nativeSurfaceListDropdownClassName}
      value={selectedValue}
      onChange={(value) => {
        descriptor.onChange?.(value)
      }}
    >
      {descriptor.sections.map((section, sectionIndex) =>
        section.title ? (
          <optgroup key={`native-dropdown-section-${sectionIndex}`} label={section.title}>
            {section.items.map((item) => (
              <option key={item.value} value={item.value}>
                {item.title}
              </option>
            ))}
          </optgroup>
        ) : (
          <Fragment key={`native-dropdown-section-${sectionIndex}`}>
            {section.items.map((item) => (
              <option key={item.value} value={item.value}>
                {item.title}
              </option>
            ))}
          </Fragment>
        )
      )}
    </NativeExtensionSelect>
  )
}

function ListRoot(props: {
  actions?: ReactElement | null
  children?: ReactNode
  filtering?: boolean
  isLoading?: boolean
  navigationTitle?: string
  onSearchTextChange?: (value: string) => void
  searchBarAccessory?: ReactElement | null
  searchBarPlaceholder?: string
  searchText?: string
}): React.JSX.Element {
  const {
    actions,
    children,
    filtering = true,
    isLoading = false,
    navigationTitle,
    onSearchTextChange,
    searchBarAccessory,
    searchBarPlaceholder,
    searchText
  } = props
  const surface = useNativeExtensionSurface()
  const [internalSearchText, setInternalSearchText] = useState(searchText ?? "")
  const [selectedIndex, setSelectedIndex] = useState(0)

  const resolvedSearchText = searchText ?? internalSearchText
  const sections = useMemo(
    () =>
      filtering
        ? filterSections(collectSections(children), resolvedSearchText)
        : collectSections(children),
    [children, filtering, resolvedSearchText]
  )
  const presentationSections = useMemo<NativeSurfaceListSectionPresentation[]>(
    () =>
      sections.map((section) => ({
        ...section,
        items: section.items.map((item) => ({
          accessory: item.accessories ? (
            <span className="shrink-0 [font-size:var(--ow-font-meta)]">{item.accessories}</span>
          ) : undefined,
          actionLabel: item.actions[0]?.title,
          hasActionPanel: item.actions.length > 1,
          icon: item.icon,
          id: item.id,
          subtitle: item.subtitle,
          title: item.title
        }))
      })),
    [sections]
  )
  const emptyView = useMemo(() => collectEmptyView(children), [children])
  const dropdown = useMemo(() => collectDropdown(searchBarAccessory), [searchBarAccessory])
  const items = sections.flatMap((section) => section.items)
  const selectedItem = items[selectedIndex] ?? null
  const listActions = useMemo(
    () =>
      actions
        ? collectActions(actions, {
            nextId: (() => {
              let actionCounter = 0
              return () => `root-action-${actionCounter++}`
            })()
          })
        : [],
    [actions]
  )
  const activeActions = selectedItem?.actions.length
    ? selectedItem.actions
    : emptyView?.actions.length
      ? emptyView.actions
      : listActions
  const footerLabel = selectedItem?.sectionTitle ?? navigationTitle ?? "Results"
  const footerCount =
    items.length > 0 ? `${Math.min(selectedIndex + 1, items.length)} of ${items.length}` : null
  const surfaceController = useNativeSurfaceController({
    actions: activeActions,
    footerCount,
    footerLabel,
    headerLabel: navigationTitle,
    primaryActionFallbackTitle: "Open"
  })
  const isListInputShortcutTarget = useCallback(
    (target: EventTarget | null): boolean => target === surface.inputRef.current,
    [surface.inputRef]
  )
  const handleMoveSelectionDownShortcut = useCallback(
    (event: KeyboardEvent): void => {
      if (!isListInputShortcutTarget(event.target) || items.length === 0) {
        return
      }

      event.preventDefault()
      setSelectedIndex((current) => Math.min(current + 1, items.length - 1))
    },
    [isListInputShortcutTarget, items.length]
  )
  const handleMoveSelectionUpShortcut = useCallback(
    (event: KeyboardEvent): void => {
      if (!isListInputShortcutTarget(event.target) || items.length === 0) {
        return
      }

      event.preventDefault()
      setSelectedIndex((current) => Math.max(current - 1, 0))
    },
    [isListInputShortcutTarget, items.length]
  )

  useShortcutScopeLayer(NATIVE_LIST_SHORTCUT_SCOPES)
  useShortcutCommandHandler(
    LAUNCHER_COMMAND_IDS.listMoveSelectionDown,
    handleMoveSelectionDownShortcut
  )
  useShortcutCommandHandler(LAUNCHER_COMMAND_IDS.listMoveSelectionUp, handleMoveSelectionUpShortcut)

  useEffect(() => {
    if (selectedIndex > items.length - 1) {
      setSelectedIndex(Math.max(items.length - 1, 0))
    }
  }, [items.length, selectedIndex])

  const handleInputChange = (value: string): void => {
    setInternalSearchText(value)
    onSearchTextChange?.(value)
    setSelectedIndex(0)
  }

  return (
    <div className="relative h-full">
      <LauncherChrome
        footer={surfaceController.footer}
        headerLeading={surfaceController.headerLeading}
        headerTrailing={dropdown ? <NativeListDropdown descriptor={dropdown} /> : null}
        inputRef={surface.inputRef}
        inputValue={resolvedSearchText}
        onInputValueChange={handleInputChange}
        placeholders={[searchBarPlaceholder ?? "Search"]}
        shellConfig={surface.shellConfig}
        surface="native-list"
      >
        {items.length > 0 ? (
          <NativeSurfaceListRows
            onExecute={(index) => {
              setSelectedIndex(index)
              const itemActions = items[index]?.actions.length ? items[index]!.actions : listActions
              const nextPrimaryAction = itemActions[0]
              if (nextPrimaryAction && !nextPrimaryAction.disabled) {
                void Promise.resolve(nextPrimaryAction.onAction())
              }
            }}
            onOpenActions={(index) => {
              setSelectedIndex(index)
              surfaceController.actionController.openActions()
            }}
            onSelect={setSelectedIndex}
            sections={presentationSections}
            selectedIndex={selectedIndex}
          />
        ) : (
          <NativeSurfaceListEmptyState
            actionTitle={surfaceController.actionController.primaryAction?.title}
            description={emptyView?.description}
            isLoading={isLoading}
            onAction={
              emptyView?.actions[0]
                ? surfaceController.actionController.executePrimaryAction
                : undefined
            }
            title={emptyView?.title}
          />
        )}
      </LauncherChrome>

      {surfaceController.actionLayer}
    </div>
  )
}

export const List = Object.assign(ListRoot, {
  Dropdown: Object.assign(ListDropdownMarker, {
    Item: ListDropdownItemMarker,
    Section: ListDropdownSectionMarker
  }),
  EmptyView: ListEmptyViewMarker,
  Item: ListItemMarker,
  Section: ListSectionMarker
})

type NativeActionPanelComponent = React.FC<{
  children?: ReactNode
}> & {
  Section: React.FC<{
    children?: ReactNode
    title?: string
  }>
  Submenu: React.FC<{
    children?: ReactNode
    title?: string
  }>
}

export const ActionPanel: NativeActionPanelComponent = Object.assign(ActionPanelMarker, {
  Section: ActionPanelSectionMarker,
  Submenu: ActionPanelSubmenuMarker
})

const ActionBase = ActionMarker as typeof ActionMarker & {
  OpenInBrowser: typeof OpenInBrowserActionMarker
  SubmitForm: typeof ActionMarker
  Style: {
    Destructive: NativeActionStyle
    Regular: NativeActionStyle
  }
}

type NativeActionComponent = React.FC<{
  disabled?: boolean
  icon?: ReactNode
  onAction?: () => void | Promise<void>
  style?: NativeActionStyle
  title: string
}> & {
  OpenInBrowser: React.FC<{
    disabled?: boolean
    icon?: ReactNode
    style?: NativeActionStyle
    title?: string
    url: string
  }>
  SubmitForm: React.FC<{
    disabled?: boolean
    icon?: ReactNode
    onAction?: () => void | Promise<void>
    style?: NativeActionStyle
    title: string
  }>
  Style: {
    Destructive: NativeActionStyle
    Regular: NativeActionStyle
  }
}

ActionBase.OpenInBrowser = OpenInBrowserActionMarker
ActionBase.SubmitForm = ActionMarker
ActionBase.Style = {
  Destructive: "destructive",
  Regular: "regular"
}

export const Action: NativeActionComponent = ActionBase
