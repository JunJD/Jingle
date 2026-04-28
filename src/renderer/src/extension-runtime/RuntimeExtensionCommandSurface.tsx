import {
  createElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from "react"
import type { LauncherActionDescriptor } from "@/features/launcher-actions/model"
import { useShortcutCommandHandler, useShortcutScopeLayer } from "@/shortcuts/shortcut-context"
import { LauncherChrome } from "@launcher-components/LauncherChrome"
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
import {
  NativeSurfaceListEmptyState,
  NativeSurfaceListRows,
  nativeSurfaceListDropdownClassName,
  type NativeSurfaceListSectionPresentation
} from "../extension-host/list-presentation"

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
      className="rounded-full bg-background px-[var(--ow-space-2)] py-[var(--ow-space-0-5)] [font-size:var(--ow-font-caption)]"
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
      className={nativeSurfaceListDropdownClassName}
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
  const presentationSections = useMemo<NativeSurfaceListSectionPresentation[]>(
    () =>
      sections.map((section) => ({
        ...section,
        items: section.items.map((item) => ({
          accessory:
            item.accessories.length > 0 ? renderAccessoryVisuals(item.accessories) : undefined,
          actionLabel: item.actions[0]?.title,
          hasActionPanel: item.actions.length > 1,
          icon: renderVisual(item.icon),
          id: item.id,
          subtitle: item.subtitle,
          title: item.title
        }))
      })),
    [sections]
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
          <div className="flex flex-1 items-center justify-center px-[var(--ow-space-6)] [font-size:var(--ow-font-body)] text-muted-foreground">
            {runtimeState.error}
          </div>
        ) : !listSnapshot ? (
          <NativeSurfaceListEmptyState isLoading />
        ) : items.length > 0 ? (
          <NativeSurfaceListRows
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
            sections={presentationSections}
            selectedIndex={selectedIndex}
          />
        ) : isRuntimeStructurePending ? (
          <div className="flex-1" />
        ) : (
          <NativeSurfaceListEmptyState
            actionTitle={surfaceController.actionController.primaryAction?.title}
            description={listSnapshot.emptyView?.description}
            isLoading={listSnapshot.isLoading}
            onAction={
              surfaceController.actionController.primaryAction
                ? surfaceController.actionController.executePrimaryAction
                : undefined
            }
            title={listSnapshot.emptyView?.title}
          />
        )}
      </LauncherChrome>

      {surfaceController.actionLayer}
    </div>
  )
}
