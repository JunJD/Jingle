import {
  createElement,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode
} from "react"
import { cjk } from "@streamdown/cjk"
import { code } from "@streamdown/code"
import { math } from "@streamdown/math"
import { mermaid } from "@streamdown/mermaid"
import { ArrowLeft, LoaderCircle } from "lucide-react"
import { Streamdown } from "streamdown"
import { ScrollArea } from "@/components/ui/scroll-area"
import type { LauncherActionDescriptor } from "@/features/launcher-actions/model"
import { cn } from "@/lib/utils"
import { useShortcutCommandHandler, useShortcutScopeLayer } from "@/shortcuts/shortcut-context"
import { LauncherChrome } from "@launcher-components/LauncherChrome"
import type {
  ExtensionActionNode,
  ExtensionDetailSurfaceSnapshot,
  ExtensionFormFieldNode,
  ExtensionFormSurfaceSnapshot,
  ExtensionRuntimeEventAck,
  ExtensionListItemNode,
  ExtensionListSectionNode,
  ExtensionListSurfaceSnapshot,
  ExtensionRuntimeNavigationRequestEvent,
  ExtensionRuntimeNavigationResponse,
  ExtensionSurfaceSnapshot,
  ExtensionSvgVisualNode,
  ExtensionVisualNode
} from "@shared/extension-runtime-protocol"
import { LAUNCHER_COMMAND_IDS } from "@shared/shortcuts/ids"
import {
  useNativeExtensionHost,
  useNativeExtensionNavigation,
  useNativeExtensionSurface,
  type NativeExtensionNavigation
} from "../extension-host/sdk"
import { NativeSurfaceChrome } from "../extension-host/chrome"
import { NativeExtensionSelect } from "../extension-host/select"
import { useNativeSurfaceController } from "../extension-host/surface-action-controller"
import {
  NativeSurfaceListEmptyState,
  NativeSurfaceListRows,
  nativeSurfaceListDropdownClassName,
  type NativeSurfaceListSectionPresentation
} from "../extension-host/list-presentation"
import {
  acknowledgeRuntimeFormLocalValue,
  reconcileRuntimeFormLocalValues,
  type RuntimeFormLocalValues,
  type RuntimeFormPendingValue,
  type RuntimeFormValue
} from "./form-local-values"

const RUNTIME_LIST_SHORTCUT_SCOPES = ["launcher.list"] as const
const streamdownPlugins = { cjk, code, math, mermaid }

function isPlainDeletionKey(event: ReactKeyboardEvent<HTMLInputElement>): boolean {
  return (
    (event.key === "Backspace" || event.key === "Delete") &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.altKey &&
    !event.shiftKey
  )
}

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

interface RuntimeFormState {
  localValues: RuntimeFormLocalValues
  pendingValues: ReadonlyMap<string, RuntimeFormPendingValue>
}

type RuntimeFormStateAction =
  | { ack: ExtensionRuntimeEventAck; type: "field.ack" }
  | { changeId: string; fieldId: string; type: "field.change"; value: RuntimeFormValue }
  | { fields: readonly ExtensionFormFieldNode[]; type: "surface.reconcile" }
  | { type: "reset" }

function createRuntimeFormState(): RuntimeFormState {
  return {
    localValues: {},
    pendingValues: new Map()
  }
}

function runtimeFormStateReducer(
  state: RuntimeFormState,
  action: RuntimeFormStateAction
): RuntimeFormState {
  if (action.type === "reset") {
    return Object.keys(state.localValues).length === 0 && state.pendingValues.size === 0
      ? state
      : createRuntimeFormState()
  }

  if (action.type === "surface.reconcile") {
    const reconciled = reconcileRuntimeFormLocalValues({
      fields: action.fields,
      localValues: state.localValues,
      pendingValues: state.pendingValues
    })

    if (
      reconciled.localValues === state.localValues &&
      reconciled.pendingValues === state.pendingValues
    ) {
      return state
    }

    return reconciled
  }

  if (action.type === "field.ack") {
    return acknowledgeRuntimeFormLocalValue({
      changeId: action.ack.changeId,
      fieldId: action.ack.fieldId,
      localValues: state.localValues,
      pendingValues: state.pendingValues
    })
  }

  const pendingValues = new Map(state.pendingValues)
  pendingValues.set(action.fieldId, {
    changeId: action.changeId,
    value: action.value
  })

  return {
    localValues: Object.is(state.localValues[action.fieldId], action.value)
      ? state.localValues
      : {
          ...state.localValues,
          [action.fieldId]: action.value
        },
    pendingValues
  }
}

function isListSnapshot(
  snapshot: ExtensionSurfaceSnapshot | null
): snapshot is ExtensionListSurfaceSnapshot {
  return snapshot?.kind === "list"
}

function isDetailSnapshot(
  snapshot: ExtensionSurfaceSnapshot | null
): snapshot is ExtensionDetailSurfaceSnapshot {
  return snapshot?.kind === "detail"
}

function isFormSnapshot(
  snapshot: ExtensionSurfaceSnapshot | null
): snapshot is ExtensionFormSurfaceSnapshot {
  return snapshot?.kind === "form"
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

function getRuntimeNavigationErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function completeRuntimeNavigationRequest(
  response: ExtensionRuntimeNavigationResponse
): Promise<void> {
  await window.api.extensionRuntime.completeNavigationRequest(response)
}

type RuntimeNavigationTarget = Pick<
  NativeExtensionNavigation,
  "goHome" | "hideLauncher" | "openCommand"
>

interface RuntimeNavigationRequestOptions {
  completeOpenCommandBeforeNavigation?: boolean
}

export async function handleRuntimeNavigationRequest(
  event: ExtensionRuntimeNavigationRequestEvent,
  navigation: RuntimeNavigationTarget,
  options: RuntimeNavigationRequestOptions = {}
): Promise<void> {
  const { request, sessionId } = event
  const okResponse: ExtensionRuntimeNavigationResponse = {
    ok: true,
    requestId: request.id,
    sessionId
  }

  try {
    switch (request.method) {
      case "go-home":
        await completeRuntimeNavigationRequest(okResponse)
        navigation.goHome()
        return
      case "hide-launcher":
        await navigation.hideLauncher()
        await completeRuntimeNavigationRequest(okResponse)
        return
      case "open-command":
        if (!request.payload) {
          throw new Error("Runtime navigation open-command request is missing a payload.")
        }

        if (request.payload.showLauncher) {
          await window.api.launcher.show()
        }

        if (options.completeOpenCommandBeforeNavigation ?? true) {
          await completeRuntimeNavigationRequest(okResponse)
          navigation.openCommand({
            commandName: request.payload.commandName,
            extensionName: request.payload.extensionName,
            kind: "extension-command"
          })
          return
        }

        navigation.openCommand({
          commandName: request.payload.commandName,
          extensionName: request.payload.extensionName,
          kind: "extension-command"
        })
        await completeRuntimeNavigationRequest(okResponse)
        return
    }
  } catch (error) {
    await completeRuntimeNavigationRequest({
      error: {
        code: "navigation_failed",
        message: getRuntimeNavigationErrorMessage(error)
      },
      ok: false,
      requestId: request.id,
      sessionId
    })
  }
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

function RuntimeSurfaceHeaderLeading(props: {
  canPop: boolean
  label?: string
  onPop: () => void
}): React.JSX.Element {
  const { canPop, label, onPop } = props
  const navigation = useNativeExtensionNavigation()
  const buttonLabel = canPop ? "Go Back" : "Go Home"

  return (
    <div className="flex min-w-0 items-center gap-[var(--ow-gap-sm)]">
      <button
        type="button"
        onClick={canPop ? onPop : navigation.goHome}
        onMouseDown={(event) => event.preventDefault()}
        className="launcher-icon-button flex h-[var(--launcher-icon-button-size)] w-[var(--launcher-icon-button-size)] shrink-0 appearance-none items-center justify-center rounded-full border-0 text-muted-foreground transition hover:text-foreground"
        aria-label={buttonLabel}
        title={buttonLabel}
      >
        <ArrowLeft className="size-[var(--ow-icon-sm)]" />
      </button>
      {label ? (
        <span className="truncate [font-size:var(--ow-font-body)] font-medium text-muted-foreground">
          {label}
        </span>
      ) : null}
    </div>
  )
}

function RuntimeDetailSurface(props: {
  createActionDescriptor: (action: ExtensionActionNode) => LauncherActionDescriptor
  onNavigateBack: () => void
  snapshot: ExtensionDetailSurfaceSnapshot
}): React.JSX.Element {
  const { createActionDescriptor, onNavigateBack, snapshot } = props
  const actionItems = useMemo(
    () => snapshot.actions.map(createActionDescriptor),
    [createActionDescriptor, snapshot.actions]
  )
  const surfaceController = useNativeSurfaceController({
    actions: actionItems,
    footerLabel: snapshot.navigationTitle ?? "Detail",
    primaryActionFallbackTitle: "Open"
  })

  return (
    <div className="relative h-full">
      <NativeSurfaceChrome
        footer={surfaceController.footer}
        headerLeading={
          <RuntimeSurfaceHeaderLeading canPop={snapshot.canPop === true} onPop={onNavigateBack} />
        }
        surface="runtime-detail"
        title={snapshot.navigationTitle}
      >
        <ScrollArea className="flex-1">
          {snapshot.isLoading ? (
            <div className="flex h-full items-center justify-center gap-[var(--ow-gap-sm)] [font-size:var(--ow-font-body)] text-muted-foreground">
              <LoaderCircle className="h-[var(--ow-icon-action)] w-[var(--ow-icon-action)] animate-spin" />
              <span>Loading...</span>
            </div>
          ) : (
            <div
              className={cn(
                "grid h-full min-h-full gap-[var(--ow-gap-lg)] px-[var(--ow-space-5)] py-[var(--ow-space-4)]",
                snapshot.metadata.length > 0 ? "grid-cols-[minmax(0,1fr)_280px]" : "grid-cols-1"
              )}
            >
              <div className="min-w-0">
                {snapshot.markdown ? (
                  <div className="native-detail-markdown [font-size:var(--ow-font-body)] leading-[var(--ow-line-chat)] text-foreground">
                    <Streamdown parseIncompleteMarkdown={false} plugins={streamdownPlugins}>
                      {snapshot.markdown}
                    </Streamdown>
                  </div>
                ) : (
                  <div className="[font-size:var(--ow-font-body)] text-muted-foreground">
                    No details available.
                  </div>
                )}
              </div>

              {snapshot.metadata.length > 0 ? (
                <div className="space-y-[var(--ow-space-3)] rounded-[var(--ow-radius-panel)] border border-border/80 bg-background-elevated/70 p-[var(--ow-space-3)]">
                  <div className="[font-size:var(--ow-font-meta)] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                    Metadata
                  </div>
                  <div className="space-y-[var(--ow-space-3)]">
                    {snapshot.metadata.map((entry) => (
                      <div
                        key={`${entry.title}:${entry.text}`}
                        className="space-y-[var(--ow-space-1)]"
                      >
                        <div className="[font-size:var(--ow-font-caption)] uppercase tracking-[0.08em] text-muted-foreground">
                          {entry.title}
                        </div>
                        <div className="break-words [font-size:var(--ow-font-body)] text-foreground">
                          {entry.text}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </ScrollArea>
      </NativeSurfaceChrome>

      {surfaceController.actionLayer}
    </div>
  )
}

function RuntimeFormSurface(props: {
  createActionDescriptor: (action: ExtensionActionNode) => LauncherActionDescriptor
  localValues: RuntimeFormLocalValues
  onFieldChange: (fieldId: string, value: RuntimeFormValue) => void
  onNavigateBack: () => void
  snapshot: ExtensionFormSurfaceSnapshot
}): React.JSX.Element {
  const { createActionDescriptor, localValues, onFieldChange, onNavigateBack, snapshot } = props
  const actionItems = useMemo(
    () => snapshot.actions.map(createActionDescriptor),
    [createActionDescriptor, snapshot.actions]
  )
  const surfaceController = useNativeSurfaceController({
    actions: actionItems,
    footerLabel: snapshot.navigationTitle ?? "Form",
    primaryActionFallbackTitle: "Submit"
  })

  const handleFieldChange = (fieldId: string, value: RuntimeFormValue): void => {
    onFieldChange(fieldId, value)
  }

  return (
    <div className="relative h-full">
      <NativeSurfaceChrome
        footer={surfaceController.footer}
        headerLeading={
          <RuntimeSurfaceHeaderLeading canPop={snapshot.canPop === true} onPop={onNavigateBack} />
        }
        surface="runtime-form"
        title={snapshot.navigationTitle}
      >
        <ScrollArea className="flex-1">
          <div className="space-y-[var(--ow-space-3)] px-[var(--ow-space-4)] py-[var(--ow-space-3)]">
            {snapshot.fields.map((field) => (
              <RuntimeFormField
                key={field.id}
                field={field}
                localValue={localValues[field.id]}
                onChange={(value) => handleFieldChange(field.id, value)}
              />
            ))}
          </div>
        </ScrollArea>
      </NativeSurfaceChrome>

      {surfaceController.actionLayer}
    </div>
  )
}

function RuntimeFormField(props: {
  field: ExtensionFormFieldNode
  localValue: RuntimeFormValue | undefined
  onChange: (value: RuntimeFormValue) => void
}): React.JSX.Element {
  const { field, localValue, onChange } = props

  if (field.kind === "separator") {
    return <div className="h-px w-full bg-border/80" />
  }

  if (field.kind === "message") {
    const toneClass =
      field.tone === "critical"
        ? "border-red-500/20 bg-red-500/8 text-red-600"
        : "border-border bg-background-elevated text-muted-foreground"

    return (
      <div
        className={`rounded-[var(--ow-radius-sm)] border px-[var(--ow-space-2-5)] py-[var(--ow-space-1-5)] [font-size:var(--ow-font-body)] leading-[var(--ow-line-body)] ${toneClass}`}
      >
        {field.text}
      </div>
    )
  }

  const label = (
    <>
      <div className="[font-size:var(--ow-font-meta)] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
        {field.title}
      </div>
      {field.description ? (
        <div className="[font-size:var(--ow-font-body)] leading-[var(--ow-line-body)] text-muted-foreground">
          {field.description}
        </div>
      ) : null}
    </>
  )

  if (field.kind === "checkbox") {
    const value = typeof localValue === "boolean" ? localValue : field.value

    return (
      <label className="block space-y-[var(--ow-space-1-5)]">
        {label}
        <span className="inline-flex items-center gap-[var(--ow-gap-sm)] [font-size:var(--ow-font-control)] text-foreground">
          <input
            type="checkbox"
            checked={value}
            onChange={(event) => onChange(event.target.checked)}
          />
          <span>{field.label ?? field.title}</span>
        </span>
      </label>
    )
  }

  const value = typeof localValue === "string" ? localValue : field.value

  if (field.kind === "dropdown") {
    return (
      <label className="block space-y-[var(--ow-space-1-5)]">
        {label}
        <NativeExtensionSelect
          className="flex h-[var(--ow-control-h-sm)] w-full appearance-none rounded-[var(--ow-radius-sm)] border border-input bg-background-elevated pl-[var(--ow-space-2-5)] pr-[var(--ow-space-6)] [font-size:var(--ow-font-control)] text-foreground outline-none transition focus-visible:ring-1 focus-visible:ring-ring"
          value={value}
          onChange={(nextValue) => onChange(nextValue)}
        >
          {field.items.map((item) => (
            <option key={item.value} value={item.value}>
              {item.title}
            </option>
          ))}
        </NativeExtensionSelect>
      </label>
    )
  }

  if (field.kind === "text-area") {
    return (
      <label className="block space-y-[var(--ow-space-1-5)]">
        {label}
        <textarea
          className="min-h-[var(--ow-textarea-min-h)] w-full rounded-[var(--ow-radius-sm)] border border-input bg-background-elevated px-[var(--ow-space-2-5)] py-[var(--ow-space-1-5)] [font-size:var(--ow-font-control)] leading-[var(--ow-line-chat)] text-foreground outline-none transition placeholder:text-muted-foreground/70 focus-visible:ring-1 focus-visible:ring-ring"
          value={value}
          placeholder={field.placeholder}
          onChange={(event) => onChange(event.target.value)}
        />
      </label>
    )
  }

  return (
    <label className="block space-y-[var(--ow-space-1-5)]">
      {label}
      <input
        className="flex h-[var(--ow-control-h-sm)] w-full rounded-[var(--ow-radius-sm)] border border-input bg-background-elevated px-[var(--ow-space-2-5)] [font-size:var(--ow-font-control)] text-foreground outline-none transition placeholder:text-muted-foreground/70 focus-visible:ring-1 focus-visible:ring-ring"
        value={value}
        placeholder={field.placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  )
}

export function RuntimeExtensionCommandSurface(): React.JSX.Element {
  const host = useNativeExtensionHost()
  const hostNavigation = useNativeExtensionNavigation()
  const surface = useNativeExtensionSurface()
  const activeSessionIdRef = useRef<string | null>(null)
  const initialSeedQueryRef = useRef(host.seedQuery)
  const lastLocalInputRef = useRef(host.seedQuery)
  const hasReceivedListSurfaceRef = useRef(false)
  const nextFormChangeIdRef = useRef(0)
  const syncInputAfterActionRef = useRef(false)
  const [formState, dispatchFormState] = useReducer(
    runtimeFormStateReducer,
    undefined,
    createRuntimeFormState
  )
  const [inputText, setInputText] = useState(host.seedQuery)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [runtimeState, setRuntimeState] = useState<RuntimeSurfaceState>({
    error: null,
    sessionId: null,
    snapshot: null
  })
  const snapshot = runtimeState.snapshot
  const detailSnapshot = isDetailSnapshot(snapshot) ? snapshot : null
  const formSnapshot = isFormSnapshot(snapshot) ? snapshot : null
  const listSnapshot = isListSnapshot(snapshot) ? snapshot : null
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
      if (!snapshot) {
        return
      }

      if (snapshot.kind === "list") {
        syncInputAfterActionRef.current = true
      }

      sendRuntimeEvent({
        actionId: action.id,
        revision: snapshot.revision,
        type: "action.execute"
      })
    },
    [sendRuntimeEvent, snapshot]
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
          const isFirstListSurface = !hasReceivedListSurfaceRef.current
          hasReceivedListSurfaceRef.current = true
          const shouldSyncInput =
            syncInputAfterActionRef.current ||
            (isFirstListSurface && lastLocalInputRef.current === initialSeedQueryRef.current) ||
            event.surface.searchText === lastLocalInputRef.current
          if (shouldSyncInput) {
            syncInputAfterActionRef.current = false
            lastLocalInputRef.current = event.surface.searchText
            setInputText(event.surface.searchText)
          }
        }

        if (event.surface.kind === "form") {
          dispatchFormState({
            fields: event.surface.fields,
            type: "surface.reconcile"
          })
        } else {
          dispatchFormState({ type: "reset" })
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
    return window.api.extensionRuntime.subscribeNavigationRequests((event) => {
      if (event.sessionId !== activeSessionIdRef.current) {
        return
      }

      void handleRuntimeNavigationRequest(event, hostNavigation)
    })
  }, [hostNavigation])

  useEffect(() => {
    return window.api.extensionRuntime.subscribeEventAcks((event) => {
      if (event.session.sessionId !== activeSessionIdRef.current) {
        return
      }

      dispatchFormState({
        ack: event.ack,
        type: "field.ack"
      })
    })
  }, [])

  useEffect(() => {
    let cancelled = false
    let sessionId: string | null = null

    hasReceivedListSurfaceRef.current = false

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
        nextFormChangeIdRef.current = 0
        dispatchFormState({ type: "reset" })
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

  const handleInputKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (event.currentTarget.value.length > 0 || !isPlainDeletionKey(event)) {
      return
    }

    event.preventDefault()
    event.stopPropagation()
    hostNavigation.goHome()
  }

  const handleFieldChange = (fieldId: string, value: RuntimeFormValue): void => {
    const changeId = `form-change-${nextFormChangeIdRef.current++}`
    dispatchFormState({ changeId, fieldId, type: "field.change", value })
    sendRuntimeEvent({
      changeId,
      fieldId,
      type: "form.field.change",
      value
    })
  }

  const handleNavigateBack = (): void => {
    sendRuntimeEvent({
      type: "navigation.pop"
    })
  }

  if (!runtimeState.error && detailSnapshot) {
    return (
      <RuntimeDetailSurface
        createActionDescriptor={createActionDescriptor}
        onNavigateBack={handleNavigateBack}
        snapshot={detailSnapshot}
      />
    )
  }

  if (!runtimeState.error && formSnapshot) {
    return (
      <RuntimeFormSurface
        createActionDescriptor={createActionDescriptor}
        localValues={formState.localValues}
        onFieldChange={handleFieldChange}
        onNavigateBack={handleNavigateBack}
        snapshot={formSnapshot}
      />
    )
  }

  return (
    <div className="relative h-full">
      <LauncherChrome
        density="compact"
        footer={surfaceController.footer}
        headerLeading={
          <RuntimeSurfaceHeaderLeading
            canPop={listSnapshot?.canPop === true}
            label={listSnapshot?.navigationTitle}
            onPop={handleNavigateBack}
          />
        }
        headerTrailing={
          listSnapshot && runtimeState.sessionId ? (
            <RuntimeListDropdown sessionId={runtimeState.sessionId} snapshot={listSnapshot} />
          ) : null
        }
        inputRef={surface.inputRef}
        inputStatus={snapshot ? surface.inputStatus : "pending"}
        inputValue={inputText}
        onInputKeyDown={handleInputKeyDown}
        onInputValueChange={handleInputChange}
        placeholders={[listSnapshot?.searchBarPlaceholder ?? "Search"]}
        shellConfig={surface.shellConfig}
        surface="runtime-list"
      >
        {runtimeState.error ? (
          <div className="flex flex-1 items-center justify-center px-[var(--ow-space-6)] [font-size:var(--ow-font-body)] text-muted-foreground">
            {runtimeState.error}
          </div>
        ) : snapshot?.kind === "error" ? (
          <NativeSurfaceListEmptyState description={snapshot.description} title={snapshot.title} />
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
