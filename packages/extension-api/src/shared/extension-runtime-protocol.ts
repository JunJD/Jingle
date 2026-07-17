import type { AppLocale } from "./i18n"
import type { NativeMenuBarIconName } from "./native-menu-bar"

export type ExtensionRuntimeCommandMode = "menu-bar" | "no-view" | "view"

export type ExtensionRuntimeInitialAction = "focus" | "open" | "submit"

export interface ExtensionRuntimeJsonObject {
  readonly [key: string]: ExtensionRuntimeJsonValue
}

export interface ExtensionRuntimeJsonArray extends ReadonlyArray<ExtensionRuntimeJsonValue> {}

export type ExtensionRuntimeJsonValue =
  | boolean
  | ExtensionRuntimeJsonArray
  | null
  | number
  | string
  | ExtensionRuntimeJsonObject

export interface ExtensionRuntimeLaunchProps {
  arguments?: ExtensionRuntimeJsonObject
  draftValues?: ExtensionRuntimeJsonObject
  fallbackText?: string
  launchContext?: ExtensionRuntimeJsonObject
}

export interface ExtensionRuntimeLaunchIntent {
  commandName: string
  extensionName: string
  initialAction: ExtensionRuntimeInitialAction
  launchProps?: ExtensionRuntimeLaunchProps
  seedQuery: string
}

export interface ExtensionRuntimeStartRequest {
  intent: ExtensionRuntimeLaunchIntent
  sessionId: string
}

export type ExtensionRuntimeHostCapability =
  | "agent"
  | "ai"
  | "clipboard"
  | "dialog"
  | "navigation"
  | "preferences"
  | "quicklinks"
  | "rpc"
  | "scheduler"
  | "settings"
  | "shell"
  | "storage"
  | "toast"

export type ExtensionRuntimeStorageScope = "command" | "extension"

export interface ExtensionRuntimeLocalStorageIdentity {
  connectionId: string
  credentialGeneration: number
}

export interface ExtensionRuntimeAvailableCacheIdentity {
  commandConfigGeneration: number
  connectionConfigGeneration: number
  extensionConfigGeneration: number
  kind: "available"
  runtimeArtifactRevision: string
  runtimePackageRevision: string
}

export interface ExtensionRuntimeUnavailableCacheIdentity {
  kind: "unavailable"
  reason: "artifact-revision-unavailable"
}

export type ExtensionRuntimeCacheIdentity =
  | ExtensionRuntimeAvailableCacheIdentity
  | ExtensionRuntimeUnavailableCacheIdentity

export interface ExtensionRuntimeDataIdentity {
  kind: "available"
  cache: ExtensionRuntimeCacheIdentity
  localStorage: ExtensionRuntimeLocalStorageIdentity
}

export interface ExtensionRuntimeUnavailableDataIdentity {
  kind: "unavailable"
}

export type ExtensionRuntimeDataIdentityState =
  | ExtensionRuntimeDataIdentity
  | ExtensionRuntimeUnavailableDataIdentity

export interface ExtensionRuntimeLaunchContext extends ExtensionRuntimeLaunchIntent {
  commandPreferences: Record<string, unknown>
  dataIdentity: ExtensionRuntimeDataIdentityState
  extensionPreferences: Record<string, unknown>
  locale: AppLocale
  mode: ExtensionRuntimeCommandMode
}

export type ExtensionRuntimeSessionKind = "ambient" | "foreground" | "run-once"

export interface ExtensionRuntimeSessionError {
  error: ExtensionRuntimeError
  issueRevision: number
  sessionId: string
}

export interface ExtensionRuntimeStorageLegacyUnownedErrorDetails {
  readonly kind: "storage-legacy-unowned"
  readonly keys: readonly string[]
  readonly scope: ExtensionRuntimeStorageScope
}

export type ExtensionRuntimeErrorDetails = ExtensionRuntimeStorageLegacyUnownedErrorDetails

export type ExtensionRuntimeStorageIssueRecovery =
  | {
      key: string
      scope: "command"
      strategy: "replace-value"
    }
  | {
      key: string
      scope: ExtensionRuntimeStorageScope
      strategy: "discard-value"
    }

export interface ExtensionRuntimeRecoverableIssue {
  code: "storage_legacy_unowned"
  id: string
  message: string
  recovery: ExtensionRuntimeStorageIssueRecovery
}

export interface ExtensionRuntimeSessionIssueSnapshot {
  readonly issues: readonly ExtensionRuntimeRecoverableIssue[]
  readonly revision: number
  readonly sessionId: string
  readonly terminal: boolean
}

export type ExtensionRuntimeRunResult =
  | { sessionId: string; status: "ready" }
  | { error: ExtensionRuntimeError; sessionId: string; status: "error" }

export type ExtensionSurfaceSnapshot =
  | ExtensionDetailSurfaceSnapshot
  | ExtensionErrorSurfaceSnapshot
  | ExtensionFormSurfaceSnapshot
  | ExtensionListSurfaceSnapshot
  | ExtensionMenuBarSurfaceSnapshot

export interface ExtensionSurfaceBase {
  canPop?: boolean
  commandName: string
  extensionName: string
  revision: number
}

export interface ExtensionListSurfaceSnapshot extends ExtensionSurfaceBase {
  actions: ExtensionActionNode[]
  emptyView?: ExtensionListEmptyViewNode
  filtering: boolean
  isLoading: boolean
  kind: "list"
  navigationTitle: string
  pagination?: ExtensionListPaginationNode
  searchBarAccessory?: ExtensionListDropdownNode
  searchBarPlaceholder?: string
  searchText: string
  sections: ExtensionListSectionNode[]
  throttle: boolean
}

export interface ExtensionListPaginationNode {
  hasMore: boolean
  isLoading: boolean
}

export interface ExtensionListSectionNode {
  id: string
  items: ExtensionListItemNode[]
  subtitle?: string
  title?: string
}

export interface ExtensionListItemNode {
  accessories: ExtensionVisualNode[]
  actions: ExtensionActionNode[]
  icon?: ExtensionVisualNode
  id: string
  keywords: string[]
  subtitle?: string
  title: string
}

export interface ExtensionListEmptyViewNode {
  actions: ExtensionActionNode[]
  description?: string
  title: string
}

export interface ExtensionListDropdownNode {
  id: string
  sections: ExtensionListDropdownSectionNode[]
  value: string
}

export interface ExtensionListDropdownSectionNode {
  id: string
  items: ExtensionListDropdownItemNode[]
  title?: string
}

export interface ExtensionListDropdownItemNode {
  icon?: ExtensionVisualNode
  title: string
  value: string
}

export interface ExtensionDetailSurfaceSnapshot extends ExtensionSurfaceBase {
  actions: ExtensionActionNode[]
  isLoading: boolean
  kind: "detail"
  markdown?: string
  metadata: ExtensionDetailMetadataNode[]
  navigationTitle: string
}

export interface ExtensionDetailMetadataNode {
  icon?: ExtensionVisualNode
  target?: string
  text: string
  title: string
}

export interface ExtensionFormSurfaceSnapshot extends ExtensionSurfaceBase {
  actions: ExtensionActionNode[]
  fields: ExtensionFormFieldNode[]
  isLoading: boolean
  kind: "form"
  navigationTitle: string
}

export type ExtensionFormFieldNode =
  | ExtensionFormCheckboxFieldNode
  | ExtensionFormDatePickerFieldNode
  | ExtensionFormDropdownFieldNode
  | ExtensionFormMessageNode
  | ExtensionFormSeparatorNode
  | ExtensionFormTagPickerFieldNode
  | ExtensionFormTextAreaFieldNode
  | ExtensionFormTextFieldNode

export interface ExtensionFormFieldBase {
  description?: string
  error?: string
  id: string
  info?: string
  title: string
}

export interface ExtensionFormTextFieldNode extends ExtensionFormFieldBase {
  autoFocus?: boolean
  focusRequestId?: number
  kind: "text-field"
  placeholder?: string
  value: string
}

export interface ExtensionFormTextAreaFieldNode extends ExtensionFormFieldBase {
  autoFocus?: boolean
  enableMarkdown?: boolean
  focusRequestId?: number
  kind: "text-area"
  placeholder?: string
  value: string
}

export interface ExtensionFormCheckboxFieldNode extends ExtensionFormFieldBase {
  autoFocus?: boolean
  focusRequestId?: number
  kind: "checkbox"
  label: string
  value: boolean
}

export interface ExtensionFormDatePickerFieldNode extends ExtensionFormFieldBase {
  autoFocus?: boolean
  focusRequestId?: number
  kind: "date-picker"
  placeholder?: string
  type?: "date" | "datetime"
  value: string
}

export interface ExtensionFormDropdownFieldNode extends ExtensionFormFieldBase {
  autoFocus?: boolean
  focusRequestId?: number
  isLoading?: boolean
  items: ExtensionFormDropdownItemNode[]
  kind: "dropdown"
  searchable?: boolean
  value: string
}

export interface ExtensionFormDropdownItemNode {
  icon?: ExtensionVisualNode
  title: string
  value: string
}

export interface ExtensionFormTagPickerFieldNode extends ExtensionFormFieldBase {
  autoFocus?: boolean
  focusRequestId?: number
  items: ExtensionFormTagPickerItemNode[]
  kind: "tag-picker"
  value: string[]
}

export interface ExtensionFormTagPickerItemNode {
  icon?: ExtensionVisualNode
  title: string
  value: string
}

export interface ExtensionFormMessageNode {
  id: string
  kind: "message"
  text: string
  tone: "critical" | "info"
}

export interface ExtensionFormSeparatorNode {
  id: string
  kind: "separator"
}

export interface ExtensionMenuBarSurfaceSnapshot extends ExtensionSurfaceBase {
  icon?: string
  iconName?: NativeMenuBarIconName
  isLoading: boolean
  kind: "menu-bar"
  sections: ExtensionMenuBarSectionNode[]
  title?: string
  tooltip?: string
}

export interface ExtensionMenuBarSectionNode {
  id: string
  items: ExtensionMenuBarItemNode[]
  title?: string
}

export interface ExtensionMenuBarItemNode {
  disabled: boolean
  icon?: string
  iconName?: NativeMenuBarIconName
  id: string
  subtitle?: string
  title: string
}

export interface ExtensionErrorSurfaceSnapshot extends ExtensionSurfaceBase {
  description: string
  kind: "error"
  title: string
}

export interface ExtensionActionNode {
  children?: ExtensionActionNode[]
  disabled: boolean
  icon?: ExtensionVisualNode
  id: string
  sectionTitle?: string
  shortcut?: ExtensionActionShortcutNode
  style: ExtensionActionStyle
  title: string
}

export type ExtensionActionStyle = "destructive" | "regular"

export interface ExtensionActionShortcutNode {
  key: string
  modifiers: string[]
}

export type ExtensionShortcutPlatform = "macOS" | "Windows" | "Linux"

export function resolveExtensionShortcutPlatform(
  platform: string
): ExtensionShortcutPlatform | undefined {
  if (platform === "darwin") {
    return "macOS"
  }
  if (platform === "win32") {
    return "Windows"
  }
  if (platform === "linux") {
    return "Linux"
  }
  return undefined
}

export interface ExtensionRunBotAgentSourceRef {
  id?: string
  label: string
  metadata?: Record<string, unknown>
  type: string
  url?: string
}

export interface ExtensionRunBotAgentPromptPlan {
  contextRefs?: ExtensionRunBotAgentSourceRef[]
  instructions?: string[]
  objective: string
  skillRefs?: string[]
}

export interface ExtensionRunBotAgentWorkflow {
  labels?: ExtensionRunBotAgentWorkflowLabel[]
  status?: string
}

export interface ExtensionRunBotAgentWorkflowLabel {
  key: string
  value?: string
}

export interface ExtensionRunBotAgentPayload {
  prompt: ExtensionRunBotAgentPromptPlan
  sourceRef?: ExtensionRunBotAgentSourceRef
  title: string
  workflow?: ExtensionRunBotAgentWorkflow
}

export interface ExtensionRuntimeRunBotAgentRequestEvent {
  request: ExtensionAgentHostRequest
  sessionId: string
}

export type ExtensionRuntimeRunBotAgentResponse =
  | {
      ok: true
      requestId: string
      result: unknown
      sessionId: string
    }
  | {
      error: ExtensionRuntimeError
      ok: false
      requestId: string
      sessionId: string
    }

export type ExtensionVisualNode =
  | ExtensionImageVisualNode
  | ExtensionInlineVisualNode
  | ExtensionSvgVisualNode
  | ExtensionTextVisualNode

export interface ExtensionTextVisualNode {
  kind: "text"
  text: string
}

export interface ExtensionImageVisualNode {
  kind: "image"
  mask?: "circle"
  source: string
  tintColor?: string
}

export interface ExtensionInlineVisualNode {
  children: ExtensionVisualNode[]
  kind: "inline"
}

export interface ExtensionSvgVisualNode {
  children: ExtensionSvgVisualNode[]
  kind: "svg"
  props: ExtensionSvgProps
  tagName: string
}

export interface ExtensionSvgProps {
  [key: string]: boolean | number | string | undefined
  "aria-hidden"?: boolean | string
  clipRule?: string
  className?: string
  cx?: number | string
  cy?: number | string
  d?: string
  fill?: string
  fillRule?: string
  focusable?: boolean | string
  height?: number | string
  points?: string
  r?: number | string
  role?: string
  stroke?: string
  strokeLinecap?: string
  strokeLinejoin?: string
  strokeWidth?: number | string
  viewBox?: string
  width?: number | string
  x1?: number | string
  x2?: number | string
  y1?: number | string
  y2?: number | string
}

export type ExtensionRuntimeEvent =
  | {
      actionId: string
      formValues?: Record<string, unknown>
      revision: number
      type: "action.execute"
    }
  | { actionId: string; type: "toast.action.execute" }
  | {
      changeId: string
      fieldId: string
      type: "form.field.change"
      value: unknown
    }
  | { query: string; type: "list.query.change" }
  | { type: "list.pagination.load-more" }
  | { type: "list.dropdown.change"; value: string }
  | { fieldId: string; query: string; type: "form.dropdown.search" }
  | { itemId: string; type: "menu-bar.item.execute" }
  | { type: "navigation.pop" }

export type ExtensionHostRequest =
  | ExtensionAgentHostRequest
  | ExtensionAiHostRequest
  | ExtensionClipboardHostRequest
  | ExtensionDialogHostRequest
  | ExtensionNavigationHostRequest
  | ExtensionOpenExternalHostRequest
  | ExtensionQuicklinksHostRequest
  | ExtensionRpcHostRequest
  | ExtensionSchedulerHostRequest
  | ExtensionSettingsHostRequest
  | ExtensionStorageHostRequest
  | ExtensionToastHostRequest

export interface ExtensionHostRequestBase {
  id: string
}

export interface ExtensionAgentHostRequest extends ExtensionHostRequestBase {
  capability: "agent"
  method: "run-bot-agent"
  payload: ExtensionRunBotAgentPayload
}

export interface ExtensionRpcHostRequest extends ExtensionHostRequestBase {
  capability: "rpc"
  method: "invoke-native-extension"
  payload: {
    extensionName: string
    method: string
    payload: unknown
  }
}

export type ExtensionStorageHostRequest =
  | ExtensionStorageAllItemsHostRequest
  | ExtensionStorageClearHostRequest
  | ExtensionStorageGetHostRequest
  | ExtensionStorageRemoveHostRequest
  | ExtensionStorageSetHostRequest

export interface ExtensionStorageGetHostRequest extends ExtensionHostRequestBase {
  capability: "storage"
  method: "get"
  payload: {
    key: string
    scope?: ExtensionRuntimeStorageScope
  }
}

export interface ExtensionStorageSetHostRequest extends ExtensionHostRequestBase {
  capability: "storage"
  method: "set"
  payload: {
    key: string
    scope?: ExtensionRuntimeStorageScope
    value: unknown
  }
}

export interface ExtensionStorageRemoveHostRequest extends ExtensionHostRequestBase {
  capability: "storage"
  method: "remove"
  payload: {
    key: string
    scope?: ExtensionRuntimeStorageScope
  }
}

export interface ExtensionStorageAllItemsHostRequest extends ExtensionHostRequestBase {
  capability: "storage"
  method: "all-items"
  payload: {
    scope?: ExtensionRuntimeStorageScope
  }
}

export interface ExtensionStorageClearHostRequest extends ExtensionHostRequestBase {
  capability: "storage"
  method: "clear"
  payload: {
    scope?: ExtensionRuntimeStorageScope
  }
}

export interface ExtensionOpenExternalHostRequest extends ExtensionHostRequestBase {
  capability: "shell"
  method: "open-external"
  payload: {
    allowedUrlSchemes?: string[]
    application?: {
      bundleId?: string
      name?: string
      path?: string
    }
    url: string
  }
}

export interface ExtensionSettingsHostRequest extends ExtensionHostRequestBase {
  capability: "settings"
  method: "open-extension"
  payload: {
    commandName?: string
    extensionName: string
  }
}

export interface ExtensionQuicklinksHostRequest extends ExtensionHostRequestBase {
  capability: "quicklinks"
  method: "register"
  payload: {
    extensionName?: string
    link: string
    name?: string
    shortcut?: {
      key: string
      modifiers: string[]
      platform: ExtensionShortcutPlatform
    }
  }
}

export type ExtensionToastStyle = "animated" | "failure" | "success"

export interface ExtensionToastActionPayload {
  id?: string
  shortcut?: ExtensionActionShortcutNode
  title: string
}

export interface ExtensionToastPayload {
  message?: string
  primaryAction?: ExtensionToastActionPayload
  secondaryAction?: ExtensionToastActionPayload
  style?: ExtensionToastStyle
  title: string
}

export interface ExtensionToastHostRequest extends ExtensionHostRequestBase {
  capability: "toast"
  method: "show"
  payload: ExtensionToastPayload
}

export interface ExtensionRuntimeToastRequestEvent {
  sessionId: string
  toast: ExtensionToastPayload
}

export type ExtensionAlertActionStyle = "cancel" | "default" | "destructive"

export interface ExtensionAlertActionPayload {
  style?: ExtensionAlertActionStyle
  title: string
}

export interface ExtensionConfirmAlertPayload {
  dismissAction?: ExtensionAlertActionPayload
  message?: string
  primaryAction?: ExtensionAlertActionPayload
  title: string
}

export interface ExtensionDialogHostRequest extends ExtensionHostRequestBase {
  capability: "dialog"
  method: "confirm-alert"
  payload: ExtensionConfirmAlertPayload
}

export interface ExtensionNavigationBaseHostRequest extends ExtensionHostRequestBase {
  capability: "navigation"
}

export interface ExtensionNavigationRootHostRequest extends ExtensionNavigationBaseHostRequest {
  method: "go-home" | "hide-launcher"
  payload?: never
}

export interface ExtensionNavigationOpenCommandHostRequest extends ExtensionNavigationBaseHostRequest {
  method: "open-command"
  payload: {
    commandName: string
    extensionName: string
    launchProps?: ExtensionRuntimeLaunchProps
    showLauncher?: boolean
  }
}

export type ExtensionNavigationHostRequest =
  | ExtensionNavigationOpenCommandHostRequest
  | ExtensionNavigationRootHostRequest

export interface ExtensionRuntimeNavigationRequestEvent {
  request: ExtensionNavigationHostRequest
  sessionId: string
}

export interface ExtensionRuntimeEventAck {
  changeId: string
  error?: ExtensionRuntimeError
  eventType: "form.field.change"
  fieldId: string
  ok: boolean
}

export type ExtensionRuntimeNavigationResponse =
  | {
      ok: true
      requestId: string
      sessionId: string
    }
  | {
      error: ExtensionRuntimeError
      ok: false
      requestId: string
      sessionId: string
    }

export type ExtensionClipboardHostRequest =
  | ExtensionClipboardReadTextHostRequest
  | ExtensionClipboardReadSelectedTextHostRequest
  | ExtensionClipboardPasteTextHostRequest
  | ExtensionClipboardWriteTextHostRequest

export interface ExtensionClipboardReadTextHostRequest extends ExtensionHostRequestBase {
  capability: "clipboard"
  method: "read-text"
  payload?: Record<string, never>
}

export interface ExtensionClipboardReadSelectedTextHostRequest extends ExtensionHostRequestBase {
  capability: "clipboard"
  method: "read-selected-text"
  payload?: Record<string, never>
}

export interface ExtensionClipboardWriteTextHostRequest extends ExtensionHostRequestBase {
  capability: "clipboard"
  method: "write-text"
  payload: {
    html?: string
    text: string
  }
}

export interface ExtensionClipboardPasteTextHostRequest extends ExtensionHostRequestBase {
  capability: "clipboard"
  method: "paste-text"
  payload: {
    html?: string
    text: string
  }
}

export interface ExtensionSchedulerHostRequest extends ExtensionHostRequestBase {
  capability: "scheduler"
  method: "set-background-refresh"
  payload: {
    commandName: string
    extensionName: string
    intervalMs: number | null
  }
}

export interface ExtensionAiHostRequest extends ExtensionHostRequestBase {
  capability: "ai"
  method: "ask"
  payload: ExtensionAiAskPayload
}

export interface ExtensionAiAskPayload {
  modelPreference?: "fast"
  modelId?: string
  prompt: string
  system?: string
  temperature?: number
}

export type ExtensionHostResponse =
  | { error: ExtensionRuntimeError; id: string; ok: false }
  | { id: string; ok: true; result: unknown }

export type ExtensionRuntimeToHostMessage =
  | { sessionId: string; type: "ready" }
  | { sessionId: string; surface: ExtensionSurfaceSnapshot; type: "surface" }
  | { ack: ExtensionRuntimeEventAck; sessionId: string; type: "event-ack" }
  | { request: ExtensionHostRequest; sessionId: string; type: "host-request" }
  | { error: ExtensionRuntimeError; sessionId: string; type: "error" }
  | { metrics: ExtensionRuntimeMetrics; sessionId: string; type: "metrics" }

export interface ExtensionRuntimeError {
  readonly code: string
  readonly details?: ExtensionRuntimeErrorDetails
  readonly message: string
}

export interface ExtensionRuntimeMetrics {
  commitDurationMs?: number
  ipcLatencyMs?: number
  rendererApplyDurationMs?: number
  snapshotBytes?: number
  snapshotRevision?: number
}

const MAX_EXTENSION_RUNTIME_ERROR_DETAIL_KEYS = 64
const MAX_EXTENSION_RUNTIME_ERROR_DETAIL_KEY_LENGTH = 1024

export function normalizeExtensionRuntimeErrorDetails(
  value: unknown,
  path = "extension runtime error details"
): ExtensionRuntimeErrorDetails {
  const normalized = normalizeExtensionRuntimeJsonFact(value, path)
  const details = assertNormalizedRecord(normalized, path)
  assertExactKeys(details, path, ["keys", "kind", "scope"])
  if (details.kind !== "storage-legacy-unowned") {
    throw new TypeError(`${path}.kind must be "storage-legacy-unowned"`)
  }
  if (details.scope !== "command" && details.scope !== "extension") {
    throw new TypeError(`${path}.scope must be "command" or "extension"`)
  }
  if (!Array.isArray(details.keys)) {
    throw new TypeError(`${path}.keys must be an array`)
  }
  if (details.keys.length === 0 || details.keys.length > MAX_EXTENSION_RUNTIME_ERROR_DETAIL_KEYS) {
    throw new TypeError(
      `${path}.keys must contain between 1 and ${MAX_EXTENSION_RUNTIME_ERROR_DETAIL_KEYS} entries`
    )
  }
  const keys: string[] = []
  const seen = new Set<string>()
  for (const [index, key] of details.keys.entries()) {
    if (typeof key !== "string") {
      throw new TypeError(`${path}.keys[${index}] must be a string`)
    }
    if (key.length > MAX_EXTENSION_RUNTIME_ERROR_DETAIL_KEY_LENGTH) {
      throw new TypeError(
        `${path}.keys[${index}] must not exceed ${MAX_EXTENSION_RUNTIME_ERROR_DETAIL_KEY_LENGTH} characters`
      )
    }
    if (seen.has(key)) {
      throw new TypeError(`${path}.keys must not contain duplicate entries`)
    }
    seen.add(key)
    keys.push(key)
  }
  return Object.freeze({
    keys: Object.freeze(keys),
    kind: "storage-legacy-unowned",
    scope: details.scope
  })
}

export function normalizeExtensionRuntimeJsonFact(
  value: unknown,
  path = "extension runtime JSON fact"
): ExtensionRuntimeJsonValue {
  return normalizeJsonFact(value, path, new Set<object>())
}

export function normalizeExtensionRuntimeLaunchProps(
  value: unknown,
  path = "extension runtime launch props"
): ExtensionRuntimeLaunchProps {
  const normalized = normalizeExtensionRuntimeJsonFact(value, path)
  const record = assertNormalizedRecord(normalized, path)
  assertExactKeys(record, path, ["arguments", "draftValues", "fallbackText", "launchContext"])

  const argumentsValue = readOptionalRecord(record, "arguments", path)
  const draftValues = readOptionalRecord(record, "draftValues", path)
  const launchContext = readOptionalRecord(record, "launchContext", path)
  const fallbackText = record.fallbackText
  if (fallbackText !== undefined && typeof fallbackText !== "string") {
    throw new TypeError(`${path}.fallbackText must be a string`)
  }

  return Object.freeze({
    ...(argumentsValue ? { arguments: argumentsValue } : {}),
    ...(draftValues ? { draftValues } : {}),
    ...(fallbackText !== undefined ? { fallbackText } : {}),
    ...(launchContext ? { launchContext } : {})
  })
}

export function normalizeExtensionRuntimeStartRequest(
  value: unknown,
  path = "extension runtime start request"
): ExtensionRuntimeStartRequest {
  const normalized = normalizeExtensionRuntimeJsonFact(value, path)
  const request = assertNormalizedRecord(normalized, path)
  assertExactKeys(request, path, ["intent", "sessionId"])

  return Object.freeze({
    intent: normalizeExtensionRuntimeLaunchIntent(request.intent, `${path}.intent`),
    sessionId: readNonEmptyString(request.sessionId, `${path}.sessionId`)
  })
}

export function normalizeExtensionRuntimeLaunchIntent(
  value: unknown,
  path = "extension runtime launch intent"
): ExtensionRuntimeLaunchIntent {
  const normalized = normalizeExtensionRuntimeJsonFact(value, path)
  const record = assertNormalizedRecord(normalized, path)
  assertExactKeys(record, path, [
    "commandName",
    "extensionName",
    "initialAction",
    "launchProps",
    "seedQuery"
  ])

  const commandName = readNonEmptyString(record.commandName, `${path}.commandName`)
  const extensionName = readNonEmptyString(record.extensionName, `${path}.extensionName`)
  const initialAction = record.initialAction
  if (initialAction !== "focus" && initialAction !== "open" && initialAction !== "submit") {
    throw new TypeError(`${path}.initialAction is invalid`)
  }
  if (typeof record.seedQuery !== "string") {
    throw new TypeError(`${path}.seedQuery must be a string`)
  }
  const launchProps = hasOwn(record, "launchProps")
    ? normalizeExtensionRuntimeLaunchProps(record.launchProps, `${path}.launchProps`)
    : undefined

  return Object.freeze({
    commandName,
    extensionName,
    initialAction,
    ...(launchProps ? { launchProps } : {}),
    seedQuery: record.seedQuery
  })
}

export function normalizeExtensionRuntimeNavigationHostRequest(
  value: unknown,
  path = "extension runtime navigation request"
): ExtensionNavigationHostRequest {
  const normalized = normalizeExtensionRuntimeJsonFact(value, path)
  const request = assertNormalizedRecord(normalized, path)
  assertExactKeys(request, path, ["capability", "id", "method", "payload"])
  if (request.capability !== "navigation") {
    throw new TypeError(`${path}.capability must be navigation`)
  }
  const id = readNonEmptyString(request.id, `${path}.id`)
  const method = request.method
  if (method !== "go-home" && method !== "hide-launcher" && method !== "open-command") {
    throw new TypeError(`${path}.method is invalid`)
  }

  if (method !== "open-command") {
    if (hasOwn(request, "payload")) {
      throw new TypeError(`${path}.payload is not supported for ${method}`)
    }
    return Object.freeze({ capability: "navigation", id, method })
  }

  const payload = assertNormalizedRecord(request.payload, `${path}.payload`)
  assertExactKeys(payload, `${path}.payload`, [
    "commandName",
    "extensionName",
    "launchProps",
    "showLauncher"
  ])
  const commandName = readNonEmptyString(payload.commandName, `${path}.payload.commandName`)
  const extensionName = readNonEmptyString(payload.extensionName, `${path}.payload.extensionName`)
  const launchProps = hasOwn(payload, "launchProps")
    ? normalizeExtensionRuntimeLaunchProps(payload.launchProps, `${path}.payload.launchProps`)
    : undefined
  const showLauncher = payload.showLauncher
  if (showLauncher !== undefined && typeof showLauncher !== "boolean") {
    throw new TypeError(`${path}.payload.showLauncher must be a boolean`)
  }

  return Object.freeze({
    capability: "navigation",
    id,
    method,
    payload: Object.freeze({
      commandName,
      extensionName,
      ...(launchProps ? { launchProps } : {}),
      ...(showLauncher !== undefined ? { showLauncher } : {})
    })
  })
}

export function normalizeExtensionRuntimeNavigationRequestEvent(
  value: unknown,
  path = "extension runtime navigation event"
): ExtensionRuntimeNavigationRequestEvent {
  const normalized = normalizeExtensionRuntimeJsonFact(value, path)
  const event = assertNormalizedRecord(normalized, path)
  assertExactKeys(event, path, ["request", "sessionId"])

  return Object.freeze({
    request: normalizeExtensionRuntimeNavigationHostRequest(event.request, `${path}.request`),
    sessionId: readNonEmptyString(event.sessionId, `${path}.sessionId`)
  })
}

function normalizeJsonFact(
  value: unknown,
  path: string,
  ancestors: Set<object>
): ExtensionRuntimeJsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError(`${path} must contain only finite numbers`)
    }
    return Object.is(value, -0) ? 0 : value
  }
  if (typeof value !== "object") {
    throw new TypeError(`${path} must contain only JSON values`)
  }
  if (ancestors.has(value)) {
    throw new TypeError(`${path} must not contain cycles`)
  }

  ancestors.add(value)
  try {
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype) {
        throw new TypeError(`${path} must use the standard Array prototype`)
      }
      const entries = readJsonArrayEntries(value, path)
      const normalized = entries.map((entry, index) =>
        normalizeJsonFact(entry, `${path}[${index}]`, ancestors)
      )
      return Object.freeze(normalized)
    }

    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(`${path} must contain only plain objects`)
    }
    const entries = readEnumerableDataEntries(value, path).map(
      ([key, entry]) =>
        [key, normalizeJsonFact(entry, `${path}[${JSON.stringify(key)}]`, ancestors)] as const
    )
    return Object.freeze(Object.fromEntries(entries))
  } finally {
    ancestors.delete(value)
  }
}

function readJsonArrayEntries(value: unknown[], path: string): unknown[] {
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length")
  if (
    !lengthDescriptor ||
    !("value" in lengthDescriptor) ||
    !Number.isSafeInteger(lengthDescriptor.value) ||
    lengthDescriptor.value < 0
  ) {
    throw new TypeError(`${path}.length must be a non-negative integer data property`)
  }
  const length = lengthDescriptor.value as number
  for (const key of Reflect.ownKeys(value)) {
    if (key === "length") {
      continue
    }
    if (typeof key !== "string" || !isArrayIndex(key, length)) {
      throw new TypeError(`${path} must not contain custom array properties`)
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor?.enumerable || !("value" in descriptor)) {
      throw new TypeError(`${path}[${key}] must be an enumerable data property`)
    }
  }
  const entries: unknown[] = []
  for (let index = 0; index < length; index += 1) {
    if (!hasOwn(value, String(index))) {
      throw new TypeError(`${path} must not contain sparse arrays`)
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
    if (!descriptor?.enumerable || !("value" in descriptor)) {
      throw new TypeError(`${path}[${index}] must be an enumerable data property`)
    }
    entries.push(descriptor.value)
  }
  return entries
}

function readEnumerableDataEntries(value: object, path: string): Array<[string, unknown]> {
  return Reflect.ownKeys(value).map((key) => {
    if (typeof key !== "string") {
      throw new TypeError(`${path} must not contain symbol keys`)
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor?.enumerable || !("value" in descriptor)) {
      throw new TypeError(`${path}[${JSON.stringify(key)}] must be an enumerable data property`)
    }
    return [key, descriptor.value]
  })
}

function assertNormalizedRecord(
  value: ExtensionRuntimeJsonValue | undefined,
  path: string
): ExtensionRuntimeJsonObject {
  if (!value || Array.isArray(value) || typeof value !== "object") {
    throw new TypeError(`${path} must be a plain object`)
  }
  return value as ExtensionRuntimeJsonObject
}

function assertExactKeys(
  record: ExtensionRuntimeJsonObject,
  path: string,
  supportedKeys: readonly string[]
): void {
  const supported = new Set(supportedKeys)
  for (const key of Object.keys(record)) {
    if (!supported.has(key)) {
      throw new TypeError(`${path} contains unsupported property ${JSON.stringify(key)}`)
    }
  }
}

function readOptionalRecord(
  record: ExtensionRuntimeJsonObject,
  key: string,
  path: string
): ExtensionRuntimeJsonObject | undefined {
  if (!hasOwn(record, key)) {
    return undefined
  }
  return assertNormalizedRecord(record[key], `${path}.${key}`)
}

function readNonEmptyString(value: ExtensionRuntimeJsonValue | undefined, path: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${path} must be a non-empty string`)
  }
  return value
}

function hasOwn(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function isArrayIndex(key: string, length: number): boolean {
  if (!/^(0|[1-9]\d*)$/.test(key)) {
    return false
  }
  const index = Number(key)
  return Number.isSafeInteger(index) && index >= 0 && index < length
}
