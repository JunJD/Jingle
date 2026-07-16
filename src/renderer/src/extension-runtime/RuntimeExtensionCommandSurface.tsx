import {
  createElement,
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
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
import { ArrowLeft, Loader2, LoaderCircle } from "lucide-react"
import { Streamdown } from "streamdown"
import { ScrollArea } from "@/components/ui/scroll-area"
import type { LauncherActionDescriptor } from "@/features/launcher-actions/model"
import { cn } from "@/lib/utils"
import { useShortcutCommandHandler, useShortcutScopeLayer } from "@/shortcuts/shortcut-context"
import { LauncherChrome } from "@launcher-components/LauncherChrome"
import type { LauncherInputElement } from "@launcher-shell/input-element"
import type {
  ExtensionActionNode,
  ExtensionDetailSurfaceSnapshot,
  ExtensionFormFieldNode,
  ExtensionFormDropdownFieldNode,
  ExtensionFormSurfaceSnapshot,
  ExtensionListSurfaceSnapshot,
  ExtensionRuntimeRunBotAgentRequestEvent,
  ExtensionSurfaceSnapshot,
  ExtensionSvgVisualNode,
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
  type RuntimeFormLocalValues,
  type RuntimeFormValue
} from "./form-local-values"
import { formatRuntimeActionShortcut, toLauncherActionShortcut } from "./runtime-action-shortcuts"
import {
  openRuntimeExternalTarget,
  projectRuntimeActiveActionNodes,
  projectRuntimeDetailMetadata,
  projectRuntimeListChrome,
  projectRuntimeListEmptyPresentation,
  projectRuntimeListItemPrimaryAction,
  projectRuntimeListSections,
  useRuntimeExtensionController,
  type RuntimeDetailMetadataViewModel,
  type RuntimeListDropdownViewModel,
  type RuntimeOpenExternalCommand
} from "./runtime-extension-controller"
import { RuntimeToastOverlay } from "./runtime-toast-overlay"
import { resolveRuntimeVisualImageSource } from "./runtime-visual-assets"
import { RuntimeRunBotAgentRequestLifecycle } from "./run-bot-agent-request-lifecycle"

const RUNTIME_LIST_SHORTCUT_SCOPES = ["launcher.list"] as const
const streamdownPlugins = { cjk, code, math, mermaid }

function isPlainDeletionKey(event: ReactKeyboardEvent<LauncherInputElement>): boolean {
  return (
    (event.key === "Backspace" || event.key === "Delete") &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.altKey &&
    !event.shiftKey
  )
}

interface RuntimeVisualRenderContext {
  extensionName: string
}

async function completeRuntimeRunBotAgentRequest(
  input: Parameters<typeof window.api.extensionRuntime.completeRunBotAgentRequest>[0]
): Promise<void> {
  await window.api.extensionRuntime.completeRunBotAgentRequest(input)
}

function getRuntimeRequestErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
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
      className="rounded-full bg-background px-[var(--jingle-space-2)] py-[var(--jingle-space-0-5)] [font-size:var(--jingle-font-caption)]"
    >
      {renderVisual(node, context)}
    </span>
  ))
}

function RuntimeListDropdown(props: {
  dropdown: RuntimeListDropdownViewModel
  onChange: (value: string) => void
}): React.JSX.Element {
  const { dropdown, onChange } = props

  return (
    <NativeExtensionSelect
      className={nativeSurfaceListDropdownClassName}
      value={dropdown.value}
      onChange={onChange}
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
  onGoHome: () => void
  onPop: () => void
}): React.JSX.Element {
  const { canPop, label, onGoHome, onPop } = props
  const buttonLabel = canPop ? "Go Back" : "Go Home"

  return (
    <div className="flex min-w-0 items-center gap-[var(--jingle-gap-sm)]">
      <button
        type="button"
        onClick={canPop ? onPop : onGoHome}
        onMouseDown={(event) => event.preventDefault()}
        className="launcher-icon-button flex h-[var(--launcher-icon-button-size)] w-[var(--launcher-icon-button-size)] shrink-0 appearance-none items-center justify-center rounded-full border-0 text-muted-foreground transition hover:text-foreground"
        aria-label={buttonLabel}
        title={buttonLabel}
      >
        <ArrowLeft className="size-[var(--jingle-icon-sm)]" />
      </button>
      {label ? (
        <span className="truncate [font-size:var(--jingle-font-body)] font-medium text-muted-foreground">
          {label}
        </span>
      ) : null}
    </div>
  )
}

function RuntimeDetailSurface(props: {
  createActionDescriptor: (action: ExtensionActionNode) => LauncherActionDescriptor
  onGoHome: () => void
  onNavigateBack: () => void
  openExternal: RuntimeOpenExternalCommand
  snapshot: ExtensionDetailSurfaceSnapshot
}): React.JSX.Element {
  const { createActionDescriptor, onGoHome, onNavigateBack, openExternal, snapshot } = props
  const actionItems = useMemo(
    () => snapshot.actions.map(createActionDescriptor),
    [createActionDescriptor, snapshot.actions]
  )
  const metadataEntries = useMemo(
    () => snapshot.metadata.map(projectRuntimeDetailMetadata),
    [snapshot.metadata]
  )
  const surfaceController = useNativeSurfaceController({
    actions: actionItems,
    footerLabel: snapshot.navigationTitle,
    invalidPrimaryActionTitle: "Action unavailable"
  })

  return (
    <div className="relative h-full">
      <NativeSurfaceChrome
        footer={surfaceController.footer}
        headerLeading={
          <RuntimeSurfaceHeaderLeading
            canPop={snapshot.canPop === true}
            onGoHome={onGoHome}
            onPop={onNavigateBack}
          />
        }
        surface="runtime-detail"
        title={snapshot.navigationTitle}
      >
        <ScrollArea className="flex-1">
          {snapshot.isLoading ? (
            <div className="flex h-full items-center justify-center gap-[var(--jingle-gap-sm)] [font-size:var(--jingle-font-body)] text-muted-foreground">
              <LoaderCircle className="h-[var(--jingle-icon-action)] w-[var(--jingle-icon-action)] animate-spin" />
              <span>Loading...</span>
            </div>
          ) : (
            <div
              className={cn(
                "grid h-full min-h-full gap-[var(--jingle-gap-lg)] px-[var(--jingle-space-5)] py-[var(--jingle-space-4)]",
                snapshot.metadata.length > 0 ? "grid-cols-[minmax(0,1fr)_280px]" : "grid-cols-1"
              )}
            >
              <div className="min-w-0">
                {snapshot.markdown ? (
                  <div className="native-detail-markdown [font-size:var(--jingle-font-body)] leading-[var(--jingle-line-chat)] text-foreground">
                    <Streamdown
                      className="jingle-markdown jingle-native-detail-markdown space-y-0 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
                      parseIncompleteMarkdown={false}
                      plugins={streamdownPlugins}
                    >
                      {snapshot.markdown}
                    </Streamdown>
                  </div>
                ) : (
                  <div className="[font-size:var(--jingle-font-body)] text-muted-foreground">
                    No details available.
                  </div>
                )}
              </div>

              {snapshot.metadata.length > 0 ? (
                <div className="space-y-[var(--jingle-space-3)] rounded-[var(--jingle-radius-panel)] border border-border/80 bg-background-elevated/70 p-[var(--jingle-space-3)]">
                  <div className="[font-size:var(--jingle-font-meta)] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                    Metadata
                  </div>
                  <div className="space-y-[var(--jingle-space-3)]">
                    {metadataEntries.map((entry) => (
                      <RuntimeDetailMetadataEntry
                        key={`${entry.title}:${entry.text}:${entry.openTarget ?? ""}`}
                        entry={entry}
                        extensionName={snapshot.extensionName}
                        openExternal={openExternal}
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
  entry: RuntimeDetailMetadataViewModel
  extensionName: string
  openExternal: RuntimeOpenExternalCommand
}): React.JSX.Element {
  const { entry, extensionName, openExternal } = props
  const canOpenTarget = entry.openTarget !== null
  const textClassName = canOpenTarget
    ? "break-words [font-size:var(--jingle-font-body)] text-primary underline-offset-2 hover:underline"
    : "break-words [font-size:var(--jingle-font-body)] text-foreground"

  const handleOpen = (): void => {
    if (!entry.openTarget) {
      return
    }

    openExternal(entry.openTarget)
  }

  return (
    <div className="space-y-[var(--jingle-space-1)]">
      <div className="flex items-center gap-[var(--jingle-gap-xs)] [font-size:var(--jingle-font-caption)] uppercase tracking-[0.08em] text-muted-foreground">
        {entry.icon ? (
          <span className="flex size-[var(--jingle-icon-sm)] items-center justify-center">
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
  onGoHome: () => void
  onNavigateBack: () => void
  snapshot: ExtensionFormSurfaceSnapshot
}): React.JSX.Element {
  const {
    createActionDescriptor,
    localValues,
    onFieldChange,
    onFormDropdownSearch,
    onGoHome,
    onNavigateBack,
    snapshot
  } = props
  const actionItems = useMemo(
    () => snapshot.actions.map(createActionDescriptor),
    [createActionDescriptor, snapshot.actions]
  )
  const surfaceController = useNativeSurfaceController({
    actions: actionItems,
    footerLabel: snapshot.navigationTitle,
    invalidPrimaryActionTitle: "Submit unavailable"
  })

  const handleFieldChange = (fieldId: string, value: RuntimeFormValue): void => {
    onFieldChange(fieldId, value)
  }

  return (
    <div className="relative h-full">
      <NativeSurfaceChrome
        footer={surfaceController.footer}
        headerLeading={
          <RuntimeSurfaceHeaderLeading
            canPop={snapshot.canPop === true}
            onGoHome={onGoHome}
            onPop={onNavigateBack}
          />
        }
        surface="runtime-form"
        title={snapshot.navigationTitle}
      >
        <ScrollArea className="flex-1">
          <div className="space-y-[var(--jingle-space-3)] px-[var(--jingle-space-4)] py-[var(--jingle-space-3)]">
            {snapshot.isLoading ? (
              <div className="flex items-center gap-[var(--jingle-gap-sm)] [font-size:var(--jingle-font-body)] text-muted-foreground">
                <Loader2 className="size-[var(--jingle-icon-sm)] animate-spin" />
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
        className={`rounded-[var(--jingle-radius-sm)] border px-[var(--jingle-space-2-5)] py-[var(--jingle-space-1-5)] [font-size:var(--jingle-font-body)] leading-[var(--jingle-line-body)] ${toneClass}`}
      >
        {field.text}
      </div>
    )
  }

  const label = (
    <>
      <div className="[font-size:var(--jingle-font-meta)] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
        {field.title}
      </div>
      {field.description ? (
        <div className="[font-size:var(--jingle-font-body)] leading-[var(--jingle-line-body)] text-muted-foreground">
          {field.description}
        </div>
      ) : null}
      {"info" in field && field.info ? (
        <div className="[font-size:var(--jingle-font-caption)] leading-[var(--jingle-line-body)] text-muted-foreground">
          {field.info}
        </div>
      ) : null}
      {"error" in field && field.error ? (
        <div className="[font-size:var(--jingle-font-body)] leading-[var(--jingle-line-body)] text-red-600">
          {field.error}
        </div>
      ) : null}
    </>
  )

  if (field.kind === "checkbox") {
    const value = typeof localValue === "boolean" ? localValue : field.value

    return (
      <label className="block space-y-[var(--jingle-space-1-5)]" data-runtime-form-field={field.id}>
        {label}
        <span className="inline-flex items-center gap-[var(--jingle-gap-sm)] [font-size:var(--jingle-font-control)] text-foreground">
          <input
            type="checkbox"
            autoFocus={autoFocus}
            checked={value}
            ref={inputRef as Ref<HTMLInputElement>}
            onChange={(event) => onChange(event.target.checked)}
          />
          <span>{field.label}</span>
        </span>
      </label>
    )
  }

  if (field.kind === "dropdown") {
    const value = typeof localValue === "string" ? localValue : field.value

    return (
      <div className="space-y-[var(--jingle-space-1-5)]" data-runtime-form-field={field.id}>
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
      <label className="block space-y-[var(--jingle-space-1-5)]" data-runtime-form-field={field.id}>
        {label}
        <select
          className="min-h-[calc(var(--jingle-control-h-sm)*2)] w-full rounded-[var(--jingle-radius-sm)] border border-input bg-background-elevated px-[var(--jingle-space-2-5)] py-[var(--jingle-space-1-5)] [font-size:var(--jingle-font-control)] text-foreground outline-none transition focus-visible:ring-1 focus-visible:ring-ring"
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
      <label className="block space-y-[var(--jingle-space-1-5)]" data-runtime-form-field={field.id}>
        {label}
        <textarea
          className="min-h-[var(--jingle-textarea-min-h)] w-full rounded-[var(--jingle-radius-sm)] border border-input bg-background-elevated px-[var(--jingle-space-2-5)] py-[var(--jingle-space-1-5)] [font-size:var(--jingle-font-control)] leading-[var(--jingle-line-chat)] text-foreground outline-none transition placeholder:text-muted-foreground/70 focus-visible:ring-1 focus-visible:ring-ring"
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
    <label className="block space-y-[var(--jingle-space-1-5)]" data-runtime-form-field={field.id}>
      {label}
      <input
        className="flex h-[var(--jingle-control-h-sm)] w-full rounded-[var(--jingle-radius-sm)] border border-input bg-background-elevated px-[var(--jingle-space-2-5)] [font-size:var(--jingle-font-control)] text-foreground outline-none transition placeholder:text-muted-foreground/70 focus-visible:ring-1 focus-visible:ring-ring"
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
        className="flex h-[var(--jingle-control-h-sm)] w-full appearance-none rounded-[var(--jingle-radius-sm)] border border-input bg-background-elevated pl-[var(--jingle-space-2-5)] pr-[var(--jingle-space-6)] [font-size:var(--jingle-font-control)] text-foreground outline-none transition focus-visible:ring-1 focus-visible:ring-ring"
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
      className="flex h-[var(--jingle-control-h-sm)] w-full items-center justify-between rounded-[var(--jingle-radius-sm)] border border-input bg-background-elevated px-[var(--jingle-space-2-5)] [font-size:var(--jingle-font-control)] text-foreground outline-none transition focus-visible:ring-1 focus-visible:ring-ring"
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

function createRuntimeActionDescriptor(params: {
  action: ExtensionActionNode
  executeActionNode: (action: ExtensionActionNode) => void
  visualRenderContext: RuntimeVisualRenderContext
}): LauncherActionDescriptor {
  const { action, executeActionNode, visualRenderContext } = params
  const children = action.children?.map((child) =>
    createRuntimeActionDescriptor({
      action: child,
      executeActionNode,
      visualRenderContext
    })
  )

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
}

export function RuntimeExtensionCommandSurface(): React.JSX.Element {
  const host = useNativeExtensionHost()
  const hostNavigation = useNativeExtensionNavigation()
  const surface = useNativeExtensionSurface()
  const activeSessionIdRef = useRef<string | null>(null)
  const controller = useRuntimeExtensionController({
    activeSessionIdRef,
    host,
    navigation: hostNavigation
  })
  const [runBotAgentRequests] = useState(() => new RuntimeRunBotAgentRequestLifecycle())
  const [selectedIndex, setSelectedIndex] = useState(0)

  const snapshot = controller.runtimeState.snapshot
  const detailSnapshot = isDetailSnapshot(snapshot) ? snapshot : null
  const formSnapshot = isFormSnapshot(snapshot) ? snapshot : null
  const listSnapshot = isListSnapshot(snapshot) ? snapshot : null
  const listDropdownProjection = controller.listDropdownProjection
  const visualRenderContext = useMemo<RuntimeVisualRenderContext | null>(
    () => (snapshot ? { extensionName: snapshot.extensionName } : null),
    [snapshot]
  )
  const sections = useMemo(
    () => projectRuntimeListSections({ query: controller.inputText, snapshot: listSnapshot }),
    [controller.inputText, listSnapshot]
  )
  const presentationSections = useMemo<NativeSurfaceListSectionPresentation[]>(
    () =>
      sections.map((section) => ({
        ...section,
        items: section.items.map((item) => ({
          accessory:
            item.accessories.length > 0 && visualRenderContext
              ? renderAccessoryVisuals(item.accessories, visualRenderContext)
              : undefined,
          actionLabel: item.actions[0]?.title,
          hasActionPanel: item.actions.length > 1,
          icon: visualRenderContext ? renderVisual(item.icon, visualRenderContext) : undefined,
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
  const listChrome = useMemo(
    () => projectRuntimeListChrome({ selectedItem, snapshot: listSnapshot }),
    [listSnapshot, selectedItem]
  )

  const sendListDropdownChange = useCallback(
    (value: string): void => {
      controller.sendEvent({
        type: "list.dropdown.change",
        value
      })
    },
    [controller]
  )
  const openExternal: RuntimeOpenExternalCommand = openRuntimeExternalTarget

  const createActionDescriptor = useCallback(
    (action: ExtensionActionNode): LauncherActionDescriptor => {
      if (!visualRenderContext) {
        throw new Error("Cannot project an extension action before its surface is ready.")
      }

      return createRuntimeActionDescriptor({
        action,
        executeActionNode: controller.executeAction,
        visualRenderContext
      })
    },
    [controller.executeAction, visualRenderContext]
  )

  const activeActionNodes = useMemo(
    () => projectRuntimeActiveActionNodes({ listSnapshot, selectedItem }),
    [listSnapshot, selectedItem]
  )
  const activeActions = useMemo(
    () => activeActionNodes.map(createActionDescriptor),
    [activeActionNodes, createActionDescriptor]
  )
  const footerCount = items.length > 0 ? `${activeSelectedIndex + 1} of ${items.length}` : null
  const surfaceController = useNativeSurfaceController({
    actions: activeActions,
    footerCount,
    footerLabel: listChrome.footerLabel,
    headerLabel: listChrome.headerLabel,
    invalidPrimaryActionTitle: "Open unavailable"
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

  const handleRunBotAgentRequest = useEffectEvent(
    (event: ExtensionRuntimeRunBotAgentRequestEvent): void => {
      if (event.sessionId !== activeSessionIdRef.current) {
        return
      }

      const request = runBotAgentRequests.begin(event.sessionId, event.request.id)
      void Promise.resolve()
        .then(async () => {
          if (!host.runBotAgent) {
            throw new Error("RunBotAgent host is not configured.")
          }

          const result = await host.runBotAgent(event.request.payload, {
            signal: request.signal
          })
          request.signal.throwIfAborted()
          if (!runBotAgentRequests.isCurrent(request)) {
            return
          }
          await completeRuntimeRunBotAgentRequest({
            ok: true,
            requestId: event.request.id,
            result,
            sessionId: event.sessionId
          })
        })
        .catch(async (error) => {
          if (!runBotAgentRequests.isCurrent(request)) {
            return
          }
          try {
            await completeRuntimeRunBotAgentRequest({
              error: {
                code: "run_bot_agent_failed",
                message: getRuntimeRequestErrorMessage(error)
              },
              ok: false,
              requestId: event.request.id,
              sessionId: event.sessionId
            })
          } catch (completionError) {
            console.error("[ExtensionRuntime] Failed to complete RunBotAgent request.", {
              completionError,
              requestId: event.request.id,
              sessionId: event.sessionId
            })
          }
        })
        .finally(() => runBotAgentRequests.release(request))
    }
  )

  useEffect(() => {
    runBotAgentRequests.syncSession(
      controller.runtimeState.sessionId,
      controller.surfaceError !== null
    )
  }, [controller.runtimeState.sessionId, controller.surfaceError, runBotAgentRequests])

  useEffect(() => {
    const unsubscribe =
      window.api.extensionRuntime.subscribeRunBotAgentRequests(handleRunBotAgentRequest)
    return () => {
      unsubscribe()
      runBotAgentRequests.dispose()
    }
  }, [runBotAgentRequests])

  const handleInputChange = (value: string): void => {
    setSelectedIndex(0)
    controller.setInputText(value, listSnapshot?.throttle === true)
  }

  const handleInputKeyDown = (event: ReactKeyboardEvent<LauncherInputElement>): void => {
    if (event.currentTarget.value.length > 0 || !isPlainDeletionKey(event)) {
      return
    }

    event.preventDefault()
    event.stopPropagation()
    controller.goHome()
  }

  const handleFieldChange = (fieldId: string, value: RuntimeFormValue): void => {
    controller.setFormFieldValue(fieldId, value)
  }

  const handleFormDropdownSearch = (fieldId: string, query: string): void => {
    controller.setFormDropdownSearch(fieldId, query)
  }

  const handleNavigateBack = (): void => {
    controller.navigateBack()
  }

  const surfaceError = controller.surfaceError
  const emptyPresentation = projectRuntimeListEmptyPresentation({
    listSnapshot,
    primaryAction: surfaceController.actionController.primaryActionPresentation,
    snapshot,
    surfaceError
  })

  if (!surfaceError && detailSnapshot) {
    return (
      <div className="relative h-full">
        <RuntimeDetailSurface
          createActionDescriptor={createActionDescriptor}
          onGoHome={controller.goHome}
          onNavigateBack={handleNavigateBack}
          openExternal={openExternal}
          snapshot={detailSnapshot}
        />
        <RuntimeToastOverlay
          onAction={controller.executeToastAction}
          onDismiss={controller.dismissToast}
          toast={controller.runtimeToast}
        />
      </div>
    )
  }

  if (!surfaceError && formSnapshot) {
    return (
      <div className="relative h-full">
        <RuntimeFormSurface
          createActionDescriptor={createActionDescriptor}
          localValues={controller.formLocalValues}
          onFieldChange={handleFieldChange}
          onFormDropdownSearch={handleFormDropdownSearch}
          onGoHome={controller.goHome}
          onNavigateBack={handleNavigateBack}
          snapshot={formSnapshot}
        />
        <RuntimeToastOverlay
          onAction={controller.executeToastAction}
          onDismiss={controller.dismissToast}
          toast={controller.runtimeToast}
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
            label={listChrome.headerLabel}
            onGoHome={controller.goHome}
            onPop={handleNavigateBack}
          />
        }
        headerTrailing={
          listDropdownProjection.kind === "ready" ? (
            <RuntimeListDropdown
              dropdown={listDropdownProjection.dropdown}
              onChange={sendListDropdownChange}
            />
          ) : null
        }
        inputRef={surface.inputRef}
        inputStatus={snapshot ? surface.inputStatus : "pending"}
        inputValue={controller.inputText}
        onInputKeyDown={handleInputKeyDown}
        onInputValueChange={handleInputChange}
        placeholders={listChrome.placeholders}
        shellConfig={surface.shellConfig}
        surface="runtime-list"
      >
        {!surfaceError && listSnapshot && items.length > 0 ? (
          <NativeSurfaceListRows
            isLoadingMore={listSnapshot.pagination?.isLoading === true}
            onLoadMore={
              listSnapshot.pagination?.hasMore
                ? () =>
                    controller.sendEvent({
                      type: "list.pagination.load-more"
                    })
                : undefined
            }
            onExecute={(index) => {
              setSelectedIndex(index)
              const primaryAction = projectRuntimeListItemPrimaryAction({
                item: items[index],
                listSnapshot
              })
              if (primaryAction && !primaryAction.disabled) {
                controller.executeAction(primaryAction)
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
          <NativeSurfaceListEmptyState presentation={emptyPresentation} />
        )}
      </LauncherChrome>

      {surfaceController.actionLayer}
      <RuntimeToastOverlay
        onAction={controller.executeToastAction}
        onDismiss={controller.dismissToast}
        toast={controller.runtimeToast}
      />
    </div>
  )
}
