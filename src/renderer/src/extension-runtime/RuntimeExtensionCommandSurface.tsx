import {
  createElement,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type Ref,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode
} from "react"
import { cjk } from "@streamdown/cjk"
import { code } from "@streamdown/code"
import { math } from "@streamdown/math"
import { mermaid } from "@streamdown/mermaid"
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Loader2,
  LoaderCircle,
  X
} from "lucide-react"
import { Streamdown } from "streamdown"
import { ScrollArea } from "@/components/ui/scroll-area"
import { matchesLauncherActionShortcut } from "@/features/launcher-actions/controller-core"
import type { LauncherActionDescriptor } from "@/features/launcher-actions/model"
import { cn } from "@/lib/utils"
import { useShortcutCommandHandler, useShortcutScopeLayer } from "@/shortcuts/shortcut-context"
import { LauncherChrome } from "@launcher-components/LauncherChrome"
import type { LauncherInputElement } from "@launcher-shell/input-element"
import type {
  ExtensionActionNode,
  ExtensionDetailMetadataNode,
  ExtensionDetailSurfaceSnapshot,
  ExtensionFormFieldNode,
  ExtensionFormDropdownFieldNode,
  ExtensionFormSurfaceSnapshot,
  ExtensionRuntimeEventAck,
  ExtensionListItemNode,
  ExtensionListSectionNode,
  ExtensionListSurfaceSnapshot,
  ExtensionSurfaceSnapshot,
  ExtensionSvgVisualNode,
  ExtensionToastActionPayload,
  ExtensionToastPayload,
  ExtensionVisualNode
} from "@shared/extension-runtime-protocol"
import { LAUNCHER_COMMAND_IDS } from "@shared/shortcuts/ids"
import {
  useNativeExtensionHost,
  useNativeExtensionNavigation,
  useNativeExtensionSurface
} from "../extension-host/sdk"
import { NativeSurfaceChrome } from "../extension-host/chrome"
import { NativeExtensionSearchableSelect, NativeExtensionSelect } from "../extension-host/select"
import { useNativeSurfaceController } from "../extension-host/surface-action-controller"
import {
  NativeSurfaceListEmptyState,
  NativeSurfaceListRows,
  nativeSurfaceListDropdownClassName,
  type NativeSurfaceListSectionPresentation
} from "../extension-host/list-presentation"
import {
  acknowledgeRuntimeFormLocalValue,
  createRuntimeFormValueOverrides,
  reconcileRuntimeFormLocalValues,
  type RuntimeFormLocalValues,
  type RuntimeFormPendingValue,
  type RuntimeFormValue
} from "./form-local-values"
import { formatRuntimeActionShortcut, toLauncherActionShortcut } from "./runtime-action-shortcuts"
import { handleRuntimeNavigationRequest } from "./runtime-navigation"
import { resolveRuntimeVisualImageSource } from "./runtime-visual-assets"

const RUNTIME_LIST_SHORTCUT_SCOPES = ["launcher.list"] as const
const RUNTIME_LIST_QUERY_THROTTLE_MS = 250
const RUNTIME_TOAST_DISMISS_MS = 3200
const streamdownPlugins = { cjk, code, math, mermaid }

function isOpenableMetadataTarget(value: string): boolean {
  try {
    const url = new URL(value)
    return (
      url.protocol === "http:" ||
      url.protocol === "https:" ||
      url.protocol === "mailto:" ||
      url.protocol === "tel:"
    )
  } catch {
    return false
  }
}

function isPlainDeletionKey(event: ReactKeyboardEvent<LauncherInputElement>): boolean {
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

interface RuntimeToastState {
  id: number
  toast: ExtensionToastPayload
}

type RuntimeExecutableToastAction = ExtensionToastActionPayload & { id: string }

interface RuntimeVisualRenderContext {
  extensionName: string
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

function renderVisual(
  node: ExtensionVisualNode | undefined,
  context: RuntimeVisualRenderContext
): ReactNode {
  if (!node) {
    return null
  }

  if (node.kind === "text") {
    return node.text
  }

  if (node.kind === "image") {
    return (
      <img
        alt=""
        aria-hidden="true"
        className={cn("h-4 w-4 object-contain", node.mask === "circle" ? "rounded-full" : null)}
        src={resolveRuntimeVisualImageSource({
          extensionName: context.extensionName,
          source: node.source
        })}
        style={{ color: node.tintColor }}
      />
    )
  }

  if (node.kind === "inline") {
    return node.children.map((child, index) => (
      <span key={`runtime-inline-${index}`}>{renderVisual(child, context)}</span>
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

function renderAccessoryVisuals(
  nodes: ExtensionVisualNode[],
  context: RuntimeVisualRenderContext
): ReactNode {
  return nodes.map((node, index) => (
    <span
      key={`runtime-accessory-${index}`}
      className="rounded-full bg-background px-[var(--ow-space-2)] py-[var(--ow-space-0-5)] [font-size:var(--ow-font-caption)]"
    >
      {renderVisual(node, context)}
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

function RuntimeToastOverlay(props: {
  onAction: (actionId: string) => void
  onDismiss: () => void
  toast: RuntimeToastState | null
}): React.JSX.Element | null {
  const { onAction, onDismiss, toast } = props
  const actions = useMemo(
    () =>
      [toast?.toast.primaryAction, toast?.toast.secondaryAction].filter(
        (action): action is RuntimeExecutableToastAction => Boolean(action?.id)
      ),
    [toast]
  )

  useEffect(() => {
    if (actions.length === 0) {
      return
    }

    const handleToastShortcut = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.isComposing) {
        return
      }

      const action = actions.find((candidate) => {
        const shortcut = toLauncherActionShortcut(candidate.shortcut)
        return shortcut ? matchesLauncherActionShortcut(shortcut, event) : false
      })
      if (!action) {
        return
      }

      event.preventDefault()
      event.stopPropagation()
      onAction(action.id)
    }

    window.addEventListener("keydown", handleToastShortcut, { capture: true })
    return () => {
      window.removeEventListener("keydown", handleToastShortcut, { capture: true })
    }
  }, [actions, onAction])

  if (!toast) {
    return null
  }

  const tone =
    toast.toast.style === "failure"
      ? "border-red-500/25 bg-red-500/8 text-red-700"
      : "border-border bg-background-elevated/95 text-foreground"
  const Icon = toast.toast.style === "failure" ? AlertCircle : CheckCircle2

  return (
    <div className="pointer-events-none absolute right-[var(--ow-space-4)] top-[var(--ow-space-4)] z-30 flex w-[min(360px,calc(100%-var(--ow-space-8)))] justify-end">
      <div
        className={cn(
          "pointer-events-auto flex min-w-0 gap-[var(--ow-gap-sm)] rounded-[var(--ow-radius-panel)] border px-[var(--ow-space-3)] py-[var(--ow-space-2)] shadow-lg backdrop-blur",
          tone
        )}
      >
        <Icon className="mt-[2px] size-[var(--ow-icon-sm)] shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="truncate [font-size:var(--ow-font-body)] font-medium">
            {toast.toast.title}
          </div>
          {toast.toast.message ? (
            <div className="mt-[var(--ow-space-0-5)] line-clamp-2 [font-size:var(--ow-font-caption)] leading-[var(--ow-line-body)] text-muted-foreground">
              {toast.toast.message}
            </div>
          ) : null}
          {actions.length > 0 ? (
            <div className="mt-[var(--ow-space-1-5)] flex flex-wrap gap-[var(--ow-gap-xs)]">
              {actions.map((action) => (
                <button
                  key={`${toast.id}:${action.title}:${action.id ?? ""}`}
                  type="button"
                  className="rounded-[var(--ow-radius-sm)] border border-border/80 bg-background px-[var(--ow-space-2)] py-[var(--ow-space-0-5)] [font-size:var(--ow-font-caption)] font-medium text-foreground transition hover:bg-muted"
                  onClick={() => {
                    onAction(action.id)
                  }}
                >
                  {action.title}
                  {action.shortcut ? (
                    <span className="ml-[var(--ow-space-1-5)] text-muted-foreground">
                      {formatRuntimeActionShortcut(action.shortcut)}
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <button
          type="button"
          aria-label="Dismiss toast"
          className="flex size-[var(--ow-icon-action)] shrink-0 items-center justify-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-foreground"
          onClick={onDismiss}
        >
          <X className="size-[var(--ow-icon-xs)]" />
        </button>
      </div>
    </div>
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
                    <Streamdown
                      className="ow-markdown ow-native-detail-markdown space-y-0 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
                      parseIncompleteMarkdown={false}
                      plugins={streamdownPlugins}
                    >
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
                      <RuntimeDetailMetadataEntry
                        key={`${entry.title}:${entry.text}:${entry.target ?? ""}`}
                        entry={entry}
                        extensionName={snapshot.extensionName}
                      />
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

function RuntimeDetailMetadataEntry(props: {
  entry: ExtensionDetailMetadataNode
  extensionName: string
}): React.JSX.Element {
  const { entry, extensionName } = props
  const canOpenTarget = entry.target ? isOpenableMetadataTarget(entry.target) : false
  const textClassName = canOpenTarget
    ? "break-words [font-size:var(--ow-font-body)] text-primary underline-offset-2 hover:underline"
    : "break-words [font-size:var(--ow-font-body)] text-foreground"

  const handleOpen = (): void => {
    if (!entry.target || !canOpenTarget) {
      return
    }

    void window.electron.openExternal(entry.target)
  }

  return (
    <div className="space-y-[var(--ow-space-1)]">
      <div className="flex items-center gap-[var(--ow-gap-xs)] [font-size:var(--ow-font-caption)] uppercase tracking-[0.08em] text-muted-foreground">
        {entry.icon ? (
          <span className="flex size-[var(--ow-icon-sm)] items-center justify-center">
            {renderVisual(entry.icon, {
              extensionName
            })}
          </span>
        ) : null}
        {entry.title}
      </div>
      {canOpenTarget ? (
        <button className={`${textClassName} text-left`} type="button" onClick={handleOpen}>
          {entry.text}
        </button>
      ) : (
        <div className={textClassName}>{entry.text}</div>
      )}
    </div>
  )
}

function RuntimeFormSurface(props: {
  createActionDescriptor: (action: ExtensionActionNode) => LauncherActionDescriptor
  localValues: RuntimeFormLocalValues
  onFieldChange: (fieldId: string, value: RuntimeFormValue) => void
  onFormDropdownSearch: (fieldId: string, query: string) => void
  onNavigateBack: () => void
  snapshot: ExtensionFormSurfaceSnapshot
}): React.JSX.Element {
  const {
    createActionDescriptor,
    localValues,
    onFieldChange,
    onFormDropdownSearch,
    onNavigateBack,
    snapshot
  } = props
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
            {snapshot.isLoading ? (
              <div className="flex items-center gap-[var(--ow-gap-sm)] [font-size:var(--ow-font-body)] text-muted-foreground">
                <Loader2 className="size-[var(--ow-icon-sm)] animate-spin" />
                <span>Loading...</span>
              </div>
            ) : null}
            {snapshot.fields.map((field) => (
              <RuntimeFormField
                key={field.id}
                field={field}
                localValue={localValues[field.id]}
                onChange={(value) => handleFieldChange(field.id, value)}
                onSearch={(query) => onFormDropdownSearch(field.id, query)}
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
  onSearch: (query: string) => void
}): React.JSX.Element {
  const { field, localValue, onChange, onSearch } = props
  const inputRef = useRef<
    HTMLButtonElement | HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null
  >(null)
  const autoFocus = getRuntimeFormFieldAutoFocus(field)
  const focusRequestId = getRuntimeFormFieldFocusRequestId(field)

  useEffect(() => {
    if (autoFocus || focusRequestId !== undefined) {
      inputRef.current?.focus()
    }
  }, [autoFocus, focusRequestId])

  if (field.kind === "separator") {
    return <div className="h-px w-full bg-border/80" data-runtime-form-field={field.id} />
  }

  if (field.kind === "message") {
    const toneClass =
      field.tone === "critical"
        ? "border-red-500/20 bg-red-500/8 text-red-600"
        : "border-border bg-background-elevated text-muted-foreground"

    return (
      <div
        data-runtime-form-field={field.id}
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
      {"info" in field && field.info ? (
        <div className="[font-size:var(--ow-font-caption)] leading-[var(--ow-line-body)] text-muted-foreground">
          {field.info}
        </div>
      ) : null}
      {"error" in field && field.error ? (
        <div className="[font-size:var(--ow-font-body)] leading-[var(--ow-line-body)] text-red-600">
          {field.error}
        </div>
      ) : null}
    </>
  )

  if (field.kind === "checkbox") {
    const value = typeof localValue === "boolean" ? localValue : field.value

    return (
      <label className="block space-y-[var(--ow-space-1-5)]" data-runtime-form-field={field.id}>
        {label}
        <span className="inline-flex items-center gap-[var(--ow-gap-sm)] [font-size:var(--ow-font-control)] text-foreground">
          <input
            type="checkbox"
            autoFocus={autoFocus}
            checked={value}
            ref={inputRef as Ref<HTMLInputElement>}
            onChange={(event) => onChange(event.target.checked)}
          />
          <span>{field.label ?? field.title}</span>
        </span>
      </label>
    )
  }

  if (field.kind === "dropdown") {
    const value = typeof localValue === "string" ? localValue : field.value

    return (
      <div className="space-y-[var(--ow-space-1-5)]" data-runtime-form-field={field.id}>
        {label}
        <RuntimeFormDropdownControl
          autoFocus={autoFocus}
          field={field}
          controlRef={inputRef as Ref<HTMLButtonElement | HTMLSelectElement>}
          onChange={onChange}
          onSearch={onSearch}
          value={value}
        />
      </div>
    )
  }

  if (field.kind === "tag-picker") {
    const value = Array.isArray(localValue) ? localValue : field.value

    return (
      <label className="block space-y-[var(--ow-space-1-5)]" data-runtime-form-field={field.id}>
        {label}
        <select
          className="min-h-[calc(var(--ow-control-h-sm)*2)] w-full rounded-[var(--ow-radius-sm)] border border-input bg-background-elevated px-[var(--ow-space-2-5)] py-[var(--ow-space-1-5)] [font-size:var(--ow-font-control)] text-foreground outline-none transition focus-visible:ring-1 focus-visible:ring-ring"
          autoFocus={autoFocus}
          multiple
          ref={inputRef as Ref<HTMLSelectElement>}
          value={value}
          onChange={(event) =>
            onChange(Array.from(event.currentTarget.selectedOptions, (option) => option.value))
          }
        >
          {field.items.map((item) => (
            <option key={item.value} value={item.value}>
              {item.title}
            </option>
          ))}
        </select>
      </label>
    )
  }

  if (field.kind === "text-area") {
    const value = typeof localValue === "string" ? localValue : field.value

    return (
      <label className="block space-y-[var(--ow-space-1-5)]" data-runtime-form-field={field.id}>
        {label}
        <textarea
          className="min-h-[var(--ow-textarea-min-h)] w-full rounded-[var(--ow-radius-sm)] border border-input bg-background-elevated px-[var(--ow-space-2-5)] py-[var(--ow-space-1-5)] [font-size:var(--ow-font-control)] leading-[var(--ow-line-chat)] text-foreground outline-none transition placeholder:text-muted-foreground/70 focus-visible:ring-1 focus-visible:ring-ring"
          autoFocus={autoFocus}
          data-markdown={field.enableMarkdown === true ? "true" : undefined}
          ref={inputRef as Ref<HTMLTextAreaElement>}
          value={value}
          placeholder={field.placeholder}
          onChange={(event) => onChange(event.target.value)}
        />
      </label>
    )
  }

  const value = typeof localValue === "string" ? localValue : field.value
  const inputType =
    field.kind === "date-picker" ? (field.type === "datetime" ? "datetime-local" : "date") : "text"

  return (
    <label className="block space-y-[var(--ow-space-1-5)]" data-runtime-form-field={field.id}>
      {label}
      <input
        className="flex h-[var(--ow-control-h-sm)] w-full rounded-[var(--ow-radius-sm)] border border-input bg-background-elevated px-[var(--ow-space-2-5)] [font-size:var(--ow-font-control)] text-foreground outline-none transition placeholder:text-muted-foreground/70 focus-visible:ring-1 focus-visible:ring-ring"
        autoFocus={autoFocus}
        type={inputType}
        ref={inputRef as Ref<HTMLInputElement>}
        value={value}
        placeholder={field.placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  )
}

function RuntimeFormDropdownControl(props: {
  autoFocus: boolean
  controlRef: Ref<HTMLButtonElement | HTMLSelectElement>
  field: ExtensionFormDropdownFieldNode
  onChange: (value: string) => void
  onSearch: (query: string) => void
  value: string
}): React.JSX.Element {
  const { autoFocus, controlRef, field, onChange, onSearch, value } = props

  if (field.searchable !== true) {
    return (
      <NativeExtensionSelect
        className="flex h-[var(--ow-control-h-sm)] w-full appearance-none rounded-[var(--ow-radius-sm)] border border-input bg-background-elevated pl-[var(--ow-space-2-5)] pr-[var(--ow-space-6)] [font-size:var(--ow-font-control)] text-foreground outline-none transition focus-visible:ring-1 focus-visible:ring-ring"
        autoFocus={autoFocus}
        ref={controlRef as Ref<HTMLSelectElement>}
        value={value}
        onChange={onChange}
      >
        {field.items.map((item) => (
          <option key={item.value} value={item.value}>
            {item.title}
          </option>
        ))}
      </NativeExtensionSelect>
    )
  }

  return (
    <NativeExtensionSearchableSelect
      className="flex h-[var(--ow-control-h-sm)] w-full items-center justify-between rounded-[var(--ow-radius-sm)] border border-input bg-background-elevated px-[var(--ow-space-2-5)] [font-size:var(--ow-font-control)] text-foreground outline-none transition focus-visible:ring-1 focus-visible:ring-ring"
      autoFocus={autoFocus}
      isLoading={field.isLoading === true}
      items={field.items}
      ref={controlRef as Ref<HTMLButtonElement>}
      value={value}
      onChange={onChange}
      onSearch={onSearch}
    />
  )
}

function getRuntimeFormFieldAutoFocus(field: ExtensionFormFieldNode): boolean {
  if (field.kind === "message" || field.kind === "separator") {
    return false
  }

  return field.autoFocus === true
}

function getRuntimeFormFieldFocusRequestId(field: ExtensionFormFieldNode): number | undefined {
  if (field.kind === "message" || field.kind === "separator") {
    return undefined
  }

  return field.focusRequestId
}

export function RuntimeExtensionCommandSurface(): React.JSX.Element {
  const host = useNativeExtensionHost()
  const hostNavigation = useNativeExtensionNavigation()
  const surface = useNativeExtensionSurface()
  const activeSessionIdRef = useRef<string | null>(null)
  const initialSeedQueryRef = useRef(host.seedQuery)
  const lastLocalInputRef = useRef(host.seedQuery)
  const hasReceivedListSurfaceRef = useRef(false)
  const listQueryThrottleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const nextFormChangeIdRef = useRef(0)
  const syncInputAfterActionRef = useRef(false)
  const toastDismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const nextToastIdRef = useRef(0)
  const [formState, dispatchFormState] = useReducer(
    runtimeFormStateReducer,
    undefined,
    createRuntimeFormState
  )
  const [inputText, setInputText] = useState(host.seedQuery)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [runtimeToast, setRuntimeToast] = useState<RuntimeToastState | null>(null)
  const [runtimeState, setRuntimeState] = useState<RuntimeSurfaceState>({
    error: null,
    sessionId: null,
    snapshot: null
  })
  const snapshot = runtimeState.snapshot
  const detailSnapshot = isDetailSnapshot(snapshot) ? snapshot : null
  const formSnapshot = isFormSnapshot(snapshot) ? snapshot : null
  const listSnapshot = isListSnapshot(snapshot) ? snapshot : null
  const visualRenderContext = useMemo<RuntimeVisualRenderContext>(
    () => ({
      extensionName: snapshot?.extensionName ?? host.extensionName
    }),
    [host.extensionName, snapshot?.extensionName]
  )
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
            item.accessories.length > 0
              ? renderAccessoryVisuals(item.accessories, visualRenderContext)
              : undefined,
          actionLabel: item.actions[0]?.title,
          hasActionPanel: item.actions.length > 1,
          icon: renderVisual(item.icon, visualRenderContext),
          id: item.id,
          subtitle: item.subtitle,
          title: item.title
        }))
      })),
    [sections, visualRenderContext]
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
  const sendListQueryChange = useCallback(
    (query: string): void => {
      sendRuntimeEvent({
        query,
        type: "list.query.change"
      })
    },
    [sendRuntimeEvent]
  )
  const clearListQueryThrottleTimer = useCallback((): void => {
    if (!listQueryThrottleTimerRef.current) {
      return
    }

    clearTimeout(listQueryThrottleTimerRef.current)
    listQueryThrottleTimerRef.current = null
  }, [])
  const clearToastDismissTimer = useCallback((): void => {
    if (!toastDismissTimerRef.current) {
      return
    }

    clearTimeout(toastDismissTimerRef.current)
    toastDismissTimerRef.current = null
  }, [])
  const dismissRuntimeToast = useCallback((): void => {
    clearToastDismissTimer()
    setRuntimeToast(null)
  }, [clearToastDismissTimer])
  const showRuntimeToast = useCallback(
    (toast: ExtensionToastPayload): void => {
      clearToastDismissTimer()
      const id = nextToastIdRef.current++
      setRuntimeToast({ id, toast })
      toastDismissTimerRef.current = setTimeout(() => {
        setRuntimeToast((current) => (current?.id === id ? null : current))
        toastDismissTimerRef.current = null
      }, RUNTIME_TOAST_DISMISS_MS)
    },
    [clearToastDismissTimer]
  )
  const executeRuntimeToastAction = useCallback(
    (actionId: string): void => {
      sendRuntimeEvent({
        actionId,
        type: "toast.action.execute"
      })
      dismissRuntimeToast()
    },
    [dismissRuntimeToast, sendRuntimeEvent]
  )
  const scheduleListQueryChange = useCallback(
    (query: string, throttle: boolean): void => {
      clearListQueryThrottleTimer()
      if (!throttle) {
        sendListQueryChange(query)
        return
      }

      listQueryThrottleTimerRef.current = setTimeout(() => {
        listQueryThrottleTimerRef.current = null
        sendListQueryChange(query)
      }, RUNTIME_LIST_QUERY_THROTTLE_MS)
    },
    [clearListQueryThrottleTimer, sendListQueryChange]
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
        formValues:
          snapshot.kind === "form"
            ? createRuntimeFormValueOverrides({
                fields: snapshot.fields,
                localValues: formState.localValues
              })
            : undefined,
        revision: snapshot.revision,
        type: "action.execute"
      })
    },
    [formState.localValues, sendRuntimeEvent, snapshot]
  )

  const createActionDescriptor = useCallback(
    (action: ExtensionActionNode): LauncherActionDescriptor => {
      const children = action.children?.map((child) => createActionDescriptor(child))

      return {
        children,
        icon: renderVisual(action.icon, visualRenderContext),
        disabled: action.disabled,
        id: action.id,
        onAction: () => {
          if (!action.disabled) {
            executeActionNode(action)
          }
        },
        sectionTitle: action.sectionTitle,
        shortcut: formatRuntimeActionShortcut(action.shortcut),
        shortcutChord: toLauncherActionShortcut(action.shortcut),
        style: action.style,
        title: action.title
      }
    },
    [executeActionNode, visualRenderContext]
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
          const localInputText = lastLocalInputRef.current
          const shouldSyncInput =
            syncInputAfterActionRef.current ||
            (isFirstListSurface && localInputText === initialSeedQueryRef.current) ||
            event.surface.searchText === localInputText
          if (shouldSyncInput) {
            syncInputAfterActionRef.current = false
            lastLocalInputRef.current = event.surface.searchText
            setInputText(event.surface.searchText)
          } else {
            void window.api.extensionRuntime.sendEvent(event.session.sessionId, {
              query: localInputText,
              type: "list.query.change"
            })
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
  }, [clearListQueryThrottleTimer])

  useEffect(() => {
    return window.api.extensionRuntime.subscribeNavigationRequests((event) => {
      if (event.sessionId !== activeSessionIdRef.current) {
        return
      }

      void handleRuntimeNavigationRequest(event, hostNavigation)
    })
  }, [hostNavigation])

  useEffect(() => {
    return window.api.extensionRuntime.subscribeToastRequests((event) => {
      if (event.sessionId !== activeSessionIdRef.current) {
        return
      }

      showRuntimeToast(event.toast)
    })
  }, [showRuntimeToast])

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
        launchProps: host.launchProps,
        locale: host.locale,
        mode: "view",
        seedQuery: initialSeedQueryRef.current
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
        clearListQueryThrottleTimer()
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
      clearListQueryThrottleTimer()
      clearToastDismissTimer()
      setRuntimeToast(null)
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
    host.launchProps,
    host.locale,
    clearListQueryThrottleTimer,
    clearToastDismissTimer
  ])

  const handleInputChange = (value: string): void => {
    lastLocalInputRef.current = value
    setInputText(value)
    setSelectedIndex(0)
    scheduleListQueryChange(value, listSnapshot?.throttle === true)
  }

  const handleInputKeyDown = (event: ReactKeyboardEvent<LauncherInputElement>): void => {
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

  const handleFormDropdownSearch = (fieldId: string, query: string): void => {
    sendRuntimeEvent({
      fieldId,
      query,
      type: "form.dropdown.search"
    })
  }

  const handleNavigateBack = (): void => {
    sendRuntimeEvent({
      type: "navigation.pop"
    })
  }

  if (!runtimeState.error && detailSnapshot) {
    return (
      <div className="relative h-full">
        <RuntimeDetailSurface
          createActionDescriptor={createActionDescriptor}
          onNavigateBack={handleNavigateBack}
          snapshot={detailSnapshot}
        />
        <RuntimeToastOverlay
          onAction={executeRuntimeToastAction}
          onDismiss={dismissRuntimeToast}
          toast={runtimeToast}
        />
      </div>
    )
  }

  if (!runtimeState.error && formSnapshot) {
    return (
      <div className="relative h-full">
        <RuntimeFormSurface
          createActionDescriptor={createActionDescriptor}
          localValues={formState.localValues}
          onFieldChange={handleFieldChange}
          onFormDropdownSearch={handleFormDropdownSearch}
          onNavigateBack={handleNavigateBack}
          snapshot={formSnapshot}
        />
        <RuntimeToastOverlay
          onAction={executeRuntimeToastAction}
          onDismiss={dismissRuntimeToast}
          toast={runtimeToast}
        />
      </div>
    )
  }

  return (
    <div className="relative h-full">
      <LauncherChrome
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
            isLoadingMore={listSnapshot.pagination?.isLoading === true}
            onLoadMore={
              listSnapshot.pagination?.hasMore
                ? () =>
                    sendRuntimeEvent({
                      type: "list.pagination.load-more"
                    })
                : undefined
            }
            onExecute={(index) => {
              setSelectedIndex(index)
              const itemActions = items[index]?.actions.length
                ? items[index]!.actions
                : listSnapshot.actions
              const primaryAction = itemActions[0]
              if (primaryAction && !primaryAction.disabled) {
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
      <RuntimeToastOverlay
        onAction={executeRuntimeToastAction}
        onDismiss={dismissRuntimeToast}
        toast={runtimeToast}
      />
    </div>
  )
}
