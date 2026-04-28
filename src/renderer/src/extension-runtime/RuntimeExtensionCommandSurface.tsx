import { ChevronRight, LoaderCircle, MoreHorizontal } from "lucide-react"
import {
  createElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from "react"
import { ScrollArea } from "@/components/ui/scroll-area"
import type { LauncherActionDescriptor } from "@/features/launcher-actions/model"
import { cn } from "@/lib/utils"
import { useShortcutCommandHandler, useShortcutScopeLayer } from "@/shortcuts/shortcut-context"
import { LauncherChrome } from "@launcher-components/LauncherChrome"
import { useSelectedRowScrollIntoView } from "@launcher-components/useSelectedRowScrollIntoView"
import type {
  ExtensionActionNode,
  ExtensionListItemNode,
  ExtensionListSectionNode,
  ExtensionListSurfaceSnapshot,
  ExtensionSurfaceSnapshot,
  ExtensionSvgVisualNode,
  ExtensionVisualNode
} from "@shared/extension-runtime-protocol"
import { LAUNCHER_COMMAND_IDS } from "@shared/shortcuts/ids"
import { useNativeExtensionHost, useNativeExtensionSurface } from "../extension-host/sdk"
import { NativeExtensionSelect } from "../extension-host/select"
import { useNativeSurfaceController } from "../extension-host/surface-action-controller"

const RUNTIME_LIST_SHORTCUT_SCOPES = ["launcher.list"] as const

interface RuntimeListItemDescriptor extends ExtensionListItemNode {
  sectionTitle?: string
}

interface RuntimeListSectionDescriptor extends Omit<ExtensionListSectionNode, "items"> {
  items: RuntimeListItemDescriptor[]
}

interface RuntimeSurfaceState {
  error: string | null
  sessionId: string | null
  snapshot: ExtensionSurfaceSnapshot | null
}

function isListSnapshot(
  snapshot: ExtensionSurfaceSnapshot | null
): snapshot is ExtensionListSurfaceSnapshot {
  return snapshot?.kind === "list"
}

function filterSections(
  sections: ExtensionListSectionNode[],
  query: string
): RuntimeListSectionDescriptor[] {
  const normalizedQuery = query.trim().toLowerCase()

  return sections
    .map((section) => ({
      ...section,
      items: section.items
        .filter((item) => {
          if (!normalizedQuery) {
            return true
          }

          const haystack = [item.title, item.subtitle ?? "", ...item.keywords]
            .join(" ")
            .toLowerCase()
          return haystack.includes(normalizedQuery)
        })
        .map((item) => ({
          ...item,
          sectionTitle: section.title
        }))
    }))
    .filter((section) => section.items.length > 0)
}

function mapSections(sections: ExtensionListSectionNode[]): RuntimeListSectionDescriptor[] {
  return sections
    .map((section) => ({
      ...section,
      items: section.items.map((item) => ({
        ...item,
        sectionTitle: section.title
      }))
    }))
    .filter((section) => section.items.length > 0)
}

function renderVisual(node: ExtensionVisualNode | undefined): ReactNode {
  if (!node) {
    return null
  }

  if (node.kind === "text") {
    return node.text
  }

  if (node.kind === "inline") {
    return node.children.map((child, index) => (
      <span key={`runtime-inline-${index}`}>{renderVisual(child)}</span>
    ))
  }

  return renderSvgVisual(node)
}

function renderSvgVisual(node: ExtensionSvgVisualNode, key?: string): ReactNode {
  return createElement(
    node.tagName,
    key ? { ...node.props, key } : node.props,
    node.children.map((child, index) => renderSvgVisual(child, `runtime-svg-${index}`))
  )
}

function renderAccessoryVisuals(nodes: ExtensionVisualNode[]): ReactNode {
  return nodes.map((node, index) => (
    <span
      key={`runtime-accessory-${index}`}
      className="rounded-full bg-background px-2 py-0.5 text-[var(--ow-font-caption)]"
    >
      {renderVisual(node)}
    </span>
  ))
}

function RuntimeListDropdown(props: {
  sessionId: string
  snapshot: ExtensionListSurfaceSnapshot
}): React.JSX.Element | null {
  const { sessionId, snapshot } = props
  const dropdown = snapshot.searchBarAccessory
  if (!dropdown) {
    return null
  }

  const value = dropdown.value ?? dropdown.sections[0]?.items[0]?.value ?? ""

  return (
    <NativeExtensionSelect
      className="h-8 max-w-[220px] appearance-none rounded-[var(--ow-radius-md)] border border-border/80 bg-background pl-3 pr-9 text-[var(--ow-font-meta)] font-medium text-foreground outline-none transition focus:border-[var(--ring)]"
      value={value}
      onChange={(nextValue) => {
        void window.api.extensionRuntime.sendEvent(sessionId, {
          type: "list.dropdown.change",
          value: nextValue
        })
      }}
    >
      {dropdown.sections.map((section) =>
        section.title ? (
          <optgroup key={section.id} label={section.title}>
            {section.items.map((item) => (
              <option key={item.value} value={item.value}>
                {item.title}
              </option>
            ))}
          </optgroup>
        ) : (
          section.items.map((item) => (
            <option key={item.value} value={item.value}>
              {item.title}
            </option>
          ))
        )
      )}
    </NativeExtensionSelect>
  )
}

function RuntimeListRows(props: {
  onExecute: (index: number) => void
  onOpenActions: (index: number) => void
  onSelect: (index: number) => void
  sections: RuntimeListSectionDescriptor[]
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
  const activeSelectedIndex = Math.min(selectedIndex, Math.max(items.length - 1, 0))

  useSelectedRowScrollIntoView({
    itemRefs,
    itemsKey,
    scrollAreaRef,
    selectedIndex: activeSelectedIndex,
    tolerance: 0
  })

  if (items.length === 0) {
    return null
  }

  return (
    <ScrollArea ref={scrollAreaRef} className="flex-1">
      <div className="py-2">
        {indexedSections.map((section) => (
          <div key={section.id}>
            {section.title ? (
              <div className="flex items-center justify-between gap-3 px-6 pb-1 pt-3 text-[12px] font-semibold text-muted-foreground">
                <span>{section.title}</span>
                {section.subtitle ? (
                  <span className="text-[10px] font-medium">{section.subtitle}</span>
                ) : null}
              </div>
            ) : null}
            {section.indexedItems.map(({ index, item }) => {
              const isSelected = index === activeSelectedIndex

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
                    "mx-2 grid h-[var(--ow-row-h-md)] grid-cols-[minmax(0,1fr)_auto] items-center gap-2.5 rounded-[var(--ow-radius-md)] px-3 text-left transition",
                    isSelected ? "bg-background-secondary" : "hover:bg-background-secondary/60"
                  )}
                >
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-3">
                      {item.icon ? (
                        <div className="flex h-5 w-5 shrink-0 items-center justify-center text-muted-foreground">
                          {renderVisual(item.icon)}
                        </div>
                      ) : null}
                      <div className="min-w-0">
                        <div className="truncate text-[var(--ow-font-body)] font-medium text-foreground">
                          {item.title}
                        </div>
                        {item.subtitle ? (
                          <div className="truncate text-[var(--ow-font-meta)] text-muted-foreground">
                            {item.subtitle}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    {item.accessories.length > 0 ? (
                      <div className="flex shrink-0 items-center gap-1 text-muted-foreground">
                        {renderAccessoryVisuals(item.accessories)}
                      </div>
                    ) : null}
                    {item.actions.length > 1 && isSelected ? (
                      <div
                        onClick={(event) => {
                          event.stopPropagation()
                          onOpenActions(index)
                        }}
                        className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground transition hover:text-foreground"
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </div>
                    ) : item.actions[0] ? (
                      <div className="flex items-center gap-2 text-[var(--ow-font-caption)] text-muted-foreground">
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

export function RuntimeExtensionCommandSurface(): React.JSX.Element {
  const host = useNativeExtensionHost()
  const surface = useNativeExtensionSurface()
  const activeSessionIdRef = useRef<string | null>(null)
  const lastLocalInputRef = useRef(host.seedQuery)
  const syncInputAfterActionRef = useRef(false)
  const [inputText, setInputText] = useState(host.seedQuery)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [runtimeState, setRuntimeState] = useState<RuntimeSurfaceState>({
    error: null,
    sessionId: null,
    snapshot: null
  })
  const snapshot = runtimeState.snapshot
  const listSnapshot = isListSnapshot(snapshot) ? snapshot : null
  const isRuntimeStructurePending =
    listSnapshot !== null && !listSnapshot.filtering && listSnapshot.searchText !== inputText
  const sections = useMemo(
    () =>
      listSnapshot
        ? listSnapshot.filtering
          ? filterSections(listSnapshot.sections, inputText)
          : mapSections(listSnapshot.sections)
        : [],
    [inputText, listSnapshot]
  )
  const items = sections.flatMap((section) => section.items)
  const activeSelectedIndex = Math.min(selectedIndex, Math.max(items.length - 1, 0))
  const selectedItem = items[activeSelectedIndex] ?? null

  const sendRuntimeEvent = useCallback(
    (event: Parameters<typeof window.api.extensionRuntime.sendEvent>[1]): void => {
      if (!runtimeState.sessionId) {
        return
      }

      void window.api.extensionRuntime.sendEvent(runtimeState.sessionId, event)
    },
    [runtimeState.sessionId]
  )

  const executeActionNode = useCallback(
    (action: ExtensionActionNode): void => {
      if (!listSnapshot) {
        return
      }

      syncInputAfterActionRef.current = true
      sendRuntimeEvent({
        actionId: action.id,
        revision: listSnapshot.revision,
        type: "action.execute"
      })
    },
    [listSnapshot, sendRuntimeEvent]
  )

  const createActionDescriptor = useCallback(
    (action: ExtensionActionNode): LauncherActionDescriptor => ({
      icon: renderVisual(action.icon),
      id: action.id,
      onAction: () => {
        if (!action.disabled) {
          executeActionNode(action)
        }
      },
      sectionTitle: action.sectionTitle,
      style: action.style,
      title: action.title
    }),
    [executeActionNode]
  )
  const listActions = useMemo(
    () => (listSnapshot?.actions ?? []).map(createActionDescriptor),
    [createActionDescriptor, listSnapshot?.actions]
  )
  const emptyViewActions = useMemo(
    () => (listSnapshot?.emptyView?.actions ?? []).map(createActionDescriptor),
    [createActionDescriptor, listSnapshot?.emptyView?.actions]
  )
  const selectedActions = useMemo(
    () => (selectedItem?.actions ?? []).map(createActionDescriptor),
    [createActionDescriptor, selectedItem?.actions]
  )
  const activeActions =
    selectedActions.length > 0
      ? selectedActions
      : emptyViewActions.length > 0
        ? emptyViewActions
        : listActions
  const footerLabel = selectedItem?.sectionTitle ?? listSnapshot?.navigationTitle ?? "Results"
  const footerCount = items.length > 0 ? `${activeSelectedIndex + 1} of ${items.length}` : null
  const surfaceController = useNativeSurfaceController({
    actions: activeActions,
    footerCount,
    footerLabel,
    headerLabel: listSnapshot?.navigationTitle,
    primaryActionFallbackTitle: "Open"
  })
  const handleMoveSelectionDownShortcut = (event: KeyboardEvent): void => {
    if (event.target !== surface.inputRef.current || items.length === 0) {
      return
    }

    event.preventDefault()
    setSelectedIndex((current) => Math.min(current + 1, items.length - 1))
  }
  const handleMoveSelectionUpShortcut = (event: KeyboardEvent): void => {
    if (event.target !== surface.inputRef.current || items.length === 0) {
      return
    }

    event.preventDefault()
    setSelectedIndex((current) => Math.max(current - 1, 0))
  }

  useShortcutScopeLayer(RUNTIME_LIST_SHORTCUT_SCOPES)
  useShortcutCommandHandler(
    LAUNCHER_COMMAND_IDS.listMoveSelectionDown,
    handleMoveSelectionDownShortcut
  )
  useShortcutCommandHandler(LAUNCHER_COMMAND_IDS.listMoveSelectionUp, handleMoveSelectionUpShortcut)

  useEffect(() => {
    const unsubscribe = window.api.extensionRuntime.subscribeSurfaces(
      (event) => {
        if (event.session.sessionId !== activeSessionIdRef.current) {
          return
        }

        setRuntimeState((current) => ({
          ...current,
          error: null,
          sessionId: event.session.sessionId,
          snapshot: event.surface
        }))

        if (event.surface.kind === "list") {
          const shouldSyncInput =
            syncInputAfterActionRef.current ||
            event.surface.searchText === lastLocalInputRef.current
          if (shouldSyncInput) {
            syncInputAfterActionRef.current = false
            lastLocalInputRef.current = event.surface.searchText
            setInputText(event.surface.searchText)
          }
        }
      },
      (error) => {
        if (error.sessionId !== activeSessionIdRef.current) {
          return
        }

        setRuntimeState((current) => ({
          ...current,
          error: error.error.message
        }))
      }
    )

    return unsubscribe
  }, [])

  useEffect(() => {
    let cancelled = false
    let sessionId: string | null = null

    void window.api.extensionRuntime
      .startForeground({
        commandName: host.commandName,
        commandPreferences: host.commandPreferences,
        extensionName: host.extensionName,
        extensionPreferences: {},
        initialAction: host.initialAction,
        mode: "view",
        seedQuery: host.seedQuery
      })
      .then((session) => {
        sessionId = session.sessionId
        if (cancelled) {
          void window.api.extensionRuntime.stopForeground(session.sessionId)
          return
        }

        activeSessionIdRef.current = session.sessionId
        setRuntimeState((current) => {
          if (current.sessionId === session.sessionId) {
            return current
          }

          return {
            error: null,
            sessionId: session.sessionId,
            snapshot: null
          }
        })
      })
      .catch((error) => {
        if (!cancelled) {
          setRuntimeState({
            error: error instanceof Error ? error.message : String(error),
            sessionId: null,
            snapshot: null
          })
        }
      })

    return () => {
      cancelled = true
      if (sessionId) {
        void window.api.extensionRuntime.stopForeground(sessionId)
      }
      activeSessionIdRef.current = null
    }
  }, [
    host.commandName,
    host.commandPreferences,
    host.extensionName,
    host.initialAction,
    host.seedQuery
  ])

  const handleInputChange = (value: string): void => {
    lastLocalInputRef.current = value
    setInputText(value)
    setSelectedIndex(0)
    sendRuntimeEvent({
      query: value,
      type: "list.query.change"
    })
  }

  return (
    <div className="relative h-full">
      <LauncherChrome
        footer={surfaceController.footer}
        headerLeading={surfaceController.headerLeading}
        headerTrailing={
          listSnapshot && runtimeState.sessionId ? (
            <RuntimeListDropdown sessionId={runtimeState.sessionId} snapshot={listSnapshot} />
          ) : null
        }
        inputRef={surface.inputRef}
        inputStatus={snapshot ? surface.inputStatus : "pending"}
        inputValue={inputText}
        onInputValueChange={handleInputChange}
        placeholders={[listSnapshot?.searchBarPlaceholder ?? "Search"]}
        shellConfig={surface.shellConfig}
        surface="runtime-list"
      >
        {runtimeState.error ? (
          <div className="flex flex-1 items-center justify-center px-6 text-[var(--ow-font-body)] text-muted-foreground">
            {runtimeState.error}
          </div>
        ) : !listSnapshot ? (
          <div className="flex flex-1 items-center justify-center gap-2 px-6 text-[var(--ow-font-body)] text-muted-foreground">
            <LoaderCircle className="h-4 w-4 animate-spin" />
            <span>Loading...</span>
          </div>
        ) : items.length > 0 ? (
          <RuntimeListRows
            onExecute={(index) => {
              setSelectedIndex(index)
              const itemActions = items[index]?.actions.length
                ? items[index]!.actions
                : listSnapshot.actions
              const primaryAction = itemActions[0]
              if (primaryAction) {
                executeActionNode(primaryAction)
              }
            }}
            onOpenActions={(index) => {
              setSelectedIndex(index)
              surfaceController.actionController.openActions()
            }}
            onSelect={setSelectedIndex}
            sections={sections}
            selectedIndex={selectedIndex}
          />
        ) : isRuntimeStructurePending ? (
          <div className="flex-1" />
        ) : (
          <div className="flex flex-1 items-center justify-center px-6">
            {listSnapshot.isLoading ? (
              <div className="flex items-center gap-2 text-[var(--ow-font-body)] text-muted-foreground">
                <LoaderCircle className="h-4 w-4 animate-spin" />
                <span>Loading...</span>
              </div>
            ) : listSnapshot.emptyView ? (
              <div className="max-w-[380px] space-y-3 text-center">
                <div className="space-y-1">
                  <div className="text-[var(--ow-font-title)] font-semibold text-foreground">
                    {listSnapshot.emptyView.title ?? "No items"}
                  </div>
                  {listSnapshot.emptyView.description ? (
                    <div className="text-[var(--ow-font-body)] leading-5 text-muted-foreground">
                      {listSnapshot.emptyView.description}
                    </div>
                  ) : null}
                </div>
                {surfaceController.actionController.primaryAction ? (
                  <button
                    type="button"
                    onClick={surfaceController.actionController.executePrimaryAction}
                    onMouseDown={(event) => event.preventDefault()}
                    className="inline-flex h-8 items-center gap-2 rounded-[var(--ow-radius-md)] border border-border bg-background px-3 text-[var(--ow-font-control)] font-medium text-foreground transition hover:bg-background-secondary"
                  >
                    <span>{surfaceController.actionController.primaryAction.title}</span>
                    <ChevronRight className="h-3.5 w-3.5" />
                  </button>
                ) : null}
              </div>
            ) : (
              <div className="text-[var(--ow-font-body)] text-muted-foreground">No items</div>
            )}
          </div>
        )}
      </LauncherChrome>

      {surfaceController.actionLayer}
    </div>
  )
}
