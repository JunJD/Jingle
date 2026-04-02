import { ArrowLeft, ChevronRight, LoaderCircle, MoreHorizontal } from "lucide-react"
import {
  Children,
  Fragment,
  isValidElement,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactElement,
  type ReactNode
} from "react"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"
import { LauncherChrome } from "../components/LauncherChrome"
import { useNativeExtensionNavigation, useNativeExtensionSurface } from "./sdk"

type NativeActionStyle = "regular" | "destructive"

interface NativeActionDescriptor {
  icon?: ReactNode
  id: string
  onAction: () => void | Promise<void>
  sectionTitle?: string
  shortcut?: string
  style?: NativeActionStyle
  title: string
}

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

type MarkerRole =
  | "list-section"
  | "list-item"
  | "list-empty-view"
  | "action-panel"
  | "action-panel-section"
  | "action-panel-submenu"
  | "action"
  | "action-open-in-browser"

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

const ActionPanelMarker = createMarkerComponent<{
  children?: ReactNode
}>("action-panel")

const ActionPanelSectionMarker = createMarkerComponent<{
  children?: ReactNode
  title?: string
}>("action-panel-section")

const ActionPanelSubmenuMarker = createMarkerComponent<{
  children?: ReactNode
  title?: string
}>("action-panel-submenu")

const ActionMarker = createMarkerComponent<{
  icon?: ReactNode
  onAction?: () => void | Promise<void>
  shortcut?: string
  style?: NativeActionStyle
  title: string
}>("action")

const OpenInBrowserActionMarker = createMarkerComponent<{
  icon?: ReactNode
  shortcut?: string
  style?: NativeActionStyle
  title?: string
  url: string
}>("action-open-in-browser")

function extractMarkerRole(node: ReactNode): MarkerRole | null {
  if (!isValidElement(node)) {
    return null
  }

  const marker = node.type as MarkerComponent
  return marker.__nativeRole ?? null
}

function collectActions(
  node: ReactNode,
  params: {
    nextId: () => string
    sectionTitle?: string
  }
): NativeActionDescriptor[] {
  const role = extractMarkerRole(node)
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

function filterSections(
  sections: NativeListSectionDescriptor[],
  query: string
): NativeListSectionDescriptor[] {
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) {
    return sections
  }

  return sections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => {
        const haystacks = [item.title, item.subtitle ?? "", ...item.keywords]
          .join(" ")
          .toLowerCase()

        return haystacks.includes(normalizedQuery)
      })
    }))
    .filter((section) => section.items.length > 0)
}

function groupActionsBySection(actions: NativeActionDescriptor[]): Array<{
  actions: NativeActionDescriptor[]
  title?: string
}> {
  const groups: Array<{ actions: NativeActionDescriptor[]; title?: string }> = []

  for (const action of actions) {
    const current = groups[groups.length - 1]
    if (!current || current.title !== action.sectionTitle) {
      groups.push({
        actions: [action],
        title: action.sectionTitle
      })
      continue
    }

    current.actions.push(action)
  }

  return groups
}

function NativeActionOverlay(props: {
  actions: NativeActionDescriptor[]
  onClose: () => void
}): React.JSX.Element {
  const { actions, onClose } = props
  const groupedActions = groupActionsBySection(actions)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const flatActions = groupedActions.flatMap((group) => group.actions)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault()
        onClose()
        return
      }

      if (event.key === "ArrowDown") {
        event.preventDefault()
        setSelectedIndex((current) => Math.min(current + 1, flatActions.length - 1))
        return
      }

      if (event.key === "ArrowUp") {
        event.preventDefault()
        setSelectedIndex((current) => Math.max(current - 1, 0))
        return
      }

      if (event.key === "Enter") {
        event.preventDefault()
        void Promise.resolve(flatActions[selectedIndex]?.onAction()).finally(onClose)
      }
    }

    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [flatActions, onClose, selectedIndex])

  return (
    <div className="absolute inset-0 z-50 bg-black/28" onClick={onClose}>
      <div
        className="absolute bottom-12 right-3 w-80 overflow-hidden rounded-2xl border border-border/80 bg-background shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="max-h-[60vh] overflow-y-auto py-2">
          {groupedActions.map((group, groupIndex) => (
            <Fragment key={`native-action-group-${groupIndex}`}>
              {group.title ? (
                <div className="px-4 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  {group.title}
                </div>
              ) : null}
              {group.actions.map((action) => {
                const index = flatActions.findIndex((entry) => entry.id === action.id)
                const isSelected = index === selectedIndex

                return (
                  <button
                    key={action.id}
                    type="button"
                    onClick={() => {
                      void Promise.resolve(action.onAction()).finally(onClose)
                    }}
                    className={cn(
                      "flex w-full items-center justify-between gap-3 px-4 py-2 text-left text-[13px] transition",
                      isSelected ? "bg-background-secondary" : "hover:bg-background-secondary/70",
                      action.style === "destructive" ? "text-red-500" : "text-foreground"
                    )}
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      {action.icon ? <div className="shrink-0">{action.icon}</div> : null}
                      <span className="truncate">{action.title}</span>
                    </div>
                    {action.shortcut ? (
                      <span className="shrink-0 text-[11px] text-muted-foreground">
                        {action.shortcut}
                      </span>
                    ) : null}
                  </button>
                )
              })}
            </Fragment>
          ))}
        </div>
      </div>
    </div>
  )
}

function NativeListRows(props: {
  onExecute: (index: number) => void
  onOpenActions: (index: number) => void
  onSelect: (index: number) => void
  sections: NativeListSectionDescriptor[]
  selectedIndex: number
}): React.JSX.Element | null {
  const { onExecute, onOpenActions, onSelect, sections, selectedIndex } = props
  const scrollAreaRef = useRef<HTMLDivElement | null>(null)
  const itemRefs = useRef<Array<HTMLDivElement | null>>([])
  const indexedSections = useMemo(
    () =>
      sections.map((section, sectionIndex) => {
        const sectionStartIndex = sections
          .slice(0, sectionIndex)
          .reduce((count, current) => count + current.items.length, 0)

        return {
          ...section,
          indexedItems: section.items.map((item, itemIndex) => ({
            index: sectionStartIndex + itemIndex,
            item
          }))
        }
      }),
    [sections]
  )
  const items = indexedSections.flatMap((section) =>
    section.indexedItems.map((indexedItem) => indexedItem.item)
  )
  const itemsKey = items.map((item) => item.id).join("|")

  useLayoutEffect(() => {
    if (selectedIndex < 0) {
      return
    }

    const viewport = scrollAreaRef.current?.querySelector(
      "[data-radix-scroll-area-viewport]"
    ) as HTMLDivElement | null
    const item = itemRefs.current[selectedIndex]
    if (!viewport || !item) {
      return
    }

    const viewportRect = viewport.getBoundingClientRect()
    const itemRect = item.getBoundingClientRect()
    if (itemRect.top < viewportRect.top) {
      viewport.scrollTop += itemRect.top - viewportRect.top
      return
    }

    if (itemRect.bottom > viewportRect.bottom) {
      viewport.scrollTop += itemRect.bottom - viewportRect.bottom
    }
  }, [itemsKey, selectedIndex])

  if (items.length === 0) {
    return null
  }

  return (
    <ScrollArea ref={scrollAreaRef} className="flex-1">
      <div className="py-2">
        {indexedSections.map((section) => (
          <div key={section.id}>
            {section.title ? (
              <div className="flex items-center justify-between gap-3 px-4 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                <span>{section.title}</span>
                {section.subtitle ? <span className="text-[10px]">{section.subtitle}</span> : null}
              </div>
            ) : null}
            {section.indexedItems.map(({ index, item }) => {
              const isSelected = index === selectedIndex

              return (
                <div
                  key={item.id}
                  ref={(element) => {
                    itemRefs.current[index] = element
                  }}
                  role="button"
                  tabIndex={-1}
                  onClick={() => onExecute(index)}
                  onMouseEnter={() => onSelect(index)}
                  className={cn(
                    "grid h-14 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 text-left transition",
                    isSelected ? "bg-background-secondary" : "hover:bg-background-secondary/60"
                  )}
                >
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-3">
                      {item.icon ? (
                        <div className="flex h-5 w-5 shrink-0 items-center justify-center text-muted-foreground">
                          {item.icon}
                        </div>
                      ) : null}
                      <div className="min-w-0">
                        <div className="truncate text-[14px] font-medium text-foreground">
                          {item.title}
                        </div>
                        {item.subtitle ? (
                          <div className="truncate text-[12px] text-muted-foreground">
                            {item.subtitle}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    {item.accessories ? (
                      <div className="shrink-0 text-[12px] text-muted-foreground">
                        {item.accessories}
                      </div>
                    ) : null}
                    {item.actions.length > 1 && isSelected ? (
                      <div
                        onClick={(event) => {
                          event.stopPropagation()
                          onOpenActions(index)
                        }}
                        className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition hover:text-foreground"
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </div>
                    ) : item.actions[0] ? (
                      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                        <span>{item.actions[0].title}</span>
                        <ChevronRight className="h-3.5 w-3.5" />
                      </div>
                    ) : null}
                  </div>
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </ScrollArea>
  )
}

function ListRoot(props: {
  actions?: ReactElement | null
  children?: ReactNode
  isLoading?: boolean
  navigationTitle?: string
  onSearchTextChange?: (value: string) => void
  searchBarPlaceholder?: string
  searchText?: string
}): React.JSX.Element {
  const {
    actions,
    children,
    isLoading = false,
    navigationTitle,
    onSearchTextChange,
    searchBarPlaceholder,
    searchText
  } = props
  const navigation = useNativeExtensionNavigation()
  const surface = useNativeExtensionSurface()
  const [internalSearchText, setInternalSearchText] = useState(searchText ?? "")
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [showActions, setShowActions] = useState(false)

  const resolvedSearchText = searchText ?? internalSearchText
  const sections = useMemo(
    () => filterSections(collectSections(children), resolvedSearchText),
    [children, resolvedSearchText]
  )
  const emptyView = useMemo(() => collectEmptyView(children), [children])
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
  const activeActions = selectedItem?.actions.length ? selectedItem.actions : listActions
  const primaryAction = activeActions[0] ?? null
  const footerLabel = selectedItem?.sectionTitle ?? navigationTitle ?? "Results"
  const footerCount =
    items.length > 0 ? `${Math.min(selectedIndex + 1, items.length)} of ${items.length}` : null

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

  const handleInputKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "ArrowDown") {
      event.preventDefault()
      setSelectedIndex((current) => Math.min(current + 1, items.length - 1))
      return
    }

    if (event.key === "ArrowUp") {
      event.preventDefault()
      setSelectedIndex((current) => Math.max(current - 1, 0))
      return
    }

    if (event.key === "Enter") {
      event.preventDefault()
      if (primaryAction) {
        void Promise.resolve(primaryAction.onAction())
      }
      return
    }

    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      if (activeActions.length > 1) {
        event.preventDefault()
        setShowActions(true)
      }
    }
  }

  return (
    <div className="relative h-full">
      <LauncherChrome
        footer={
          <>
            <div className="flex min-w-0 items-center gap-3">
              <div className="truncate text-[12px] uppercase tracking-[0.12em] text-muted-foreground">
                {footerLabel}
              </div>
              {footerCount ? (
                <div className="shrink-0 text-[12px] text-muted-foreground">{footerCount}</div>
              ) : null}
            </div>

            <div className="flex items-center gap-2">
              {activeActions.length > 1 ? (
                <button
                  type="button"
                  onClick={() => setShowActions(true)}
                  onMouseDown={(event) => event.preventDefault()}
                  className="launcher-action-link flex items-center gap-2 rounded-[10px] px-3 py-1 text-[13px] font-medium text-foreground"
                >
                  <span>Actions</span>
                  <span className="launcher-shortcut text-[11px] text-muted-foreground">⌘K</span>
                </button>
              ) : null}

              <button
                type="button"
                onClick={() => {
                  if (primaryAction) {
                    void Promise.resolve(primaryAction.onAction())
                  }
                }}
                onMouseDown={(event) => event.preventDefault()}
                disabled={!primaryAction}
                className="launcher-action-link flex items-center gap-2 rounded-[10px] px-3 py-1 text-[13px] font-medium text-foreground disabled:opacity-40"
              >
                <span>{primaryAction?.title ?? "Open"}</span>
                <span className="launcher-shortcut text-[11px] text-muted-foreground">↵</span>
              </button>
            </div>
          </>
        }
        headerLeading={
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={navigation.goHome}
              onMouseDown={(event) => event.preventDefault()}
              className="launcher-icon-button flex h-9 w-9 shrink-0 appearance-none items-center justify-center rounded-full border-0 text-muted-foreground transition hover:text-foreground"
              aria-label="Go Home"
            >
              <ArrowLeft className="size-5" />
            </button>
            {navigationTitle ? (
              <span className="truncate text-[12px] uppercase tracking-[0.12em] text-muted-foreground">
                {navigationTitle}
              </span>
            ) : null}
          </div>
        }
        inputRef={surface.inputRef}
        inputValue={resolvedSearchText}
        onInputKeyDown={handleInputKeyDown}
        onInputValueChange={handleInputChange}
        placeholder={searchBarPlaceholder ?? "Search"}
        shellConfig={surface.shellConfig}
        surface="native-list"
      >
        {items.length > 0 ? (
          <NativeListRows
            onExecute={(index) => {
              setSelectedIndex(index)
              const itemActions = items[index]?.actions.length ? items[index]!.actions : listActions
              const nextPrimaryAction = itemActions[0]
              if (nextPrimaryAction) {
                void Promise.resolve(nextPrimaryAction.onAction())
              }
            }}
            onOpenActions={(index) => {
              setSelectedIndex(index)
              setShowActions(true)
            }}
            onSelect={setSelectedIndex}
            sections={sections}
            selectedIndex={selectedIndex}
          />
        ) : (
          <div className="flex flex-1 items-center justify-center px-8">
            {isLoading ? (
              <div className="flex items-center gap-3 text-[13px] text-muted-foreground">
                <LoaderCircle className="h-4 w-4 animate-spin" />
                <span>Loading...</span>
              </div>
            ) : emptyView ? (
              <div className="max-w-[420px] space-y-4 text-center">
                <div className="space-y-1">
                  <div className="text-[15px] font-semibold text-foreground">
                    {emptyView.title ?? "No items"}
                  </div>
                  {emptyView.description ? (
                    <div className="text-[13px] leading-6 text-muted-foreground">
                      {emptyView.description}
                    </div>
                  ) : null}
                </div>
                {emptyView.actions[0] ? (
                  <button
                    type="button"
                    onClick={() => {
                      void Promise.resolve(emptyView.actions[0]?.onAction())
                    }}
                    onMouseDown={(event) => event.preventDefault()}
                    className="inline-flex items-center gap-2 rounded-[10px] border border-border bg-background px-3 py-2 text-[13px] font-medium text-foreground transition hover:bg-background-secondary"
                  >
                    <span>{emptyView.actions[0].title}</span>
                    <ChevronRight className="h-3.5 w-3.5" />
                  </button>
                ) : null}
              </div>
            ) : (
              <div className="text-[13px] text-muted-foreground">No items</div>
            )}
          </div>
        )}
      </LauncherChrome>

      {showActions && activeActions.length > 1 ? (
        <NativeActionOverlay actions={activeActions} onClose={() => setShowActions(false)} />
      ) : null}
    </div>
  )
}

export const List = Object.assign(ListRoot, {
  EmptyView: ListEmptyViewMarker,
  Item: ListItemMarker,
  Section: ListSectionMarker
})

export const ActionPanel = Object.assign(ActionPanelMarker, {
  Section: ActionPanelSectionMarker,
  Submenu: ActionPanelSubmenuMarker
})

const ActionBase = ActionMarker as MarkerComponent<React.ComponentProps<typeof ActionMarker>> & {
  OpenInBrowser: typeof OpenInBrowserActionMarker
  Style: {
    Destructive: NativeActionStyle
    Regular: NativeActionStyle
  }
}

ActionBase.OpenInBrowser = OpenInBrowserActionMarker
ActionBase.Style = {
  Destructive: "destructive",
  Regular: "regular"
}

export const Action = ActionBase
