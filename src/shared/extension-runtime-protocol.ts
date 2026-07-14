import type { AppLocale } from "./i18n"
import type { NativeMenuBarIconName } from "./native-menu-bar"

export type ExtensionRuntimeCommandMode = "menu-bar" | "no-view" | "view"

export type ExtensionRuntimeInitialAction = "focus" | "open" | "submit"

export interface ExtensionRuntimeLaunchProps {
  arguments?: Record<string, unknown>
  draftValues?: Record<string, unknown>
  fallbackText?: string
  launchContext?: Record<string, unknown>
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

export interface ExtensionRuntimeLaunchContext {
  commandName: string
  commandPreferences: Record<string, unknown>
  extensionName: string
  extensionPreferences: Record<string, unknown>
  initialAction: ExtensionRuntimeInitialAction
  launchProps?: ExtensionRuntimeLaunchProps
  locale: AppLocale
  mode: ExtensionRuntimeCommandMode
  seedQuery: string
}

export type ExtensionRuntimeLaunchPackageRef =
  | {
      extensionName: string
      kind: "built-in"
      version: string
    }
  | {
      extensionName: string
      kind: "module"
      modulePath: string
      version: string
    }

export interface ExtensionRuntimeForegroundStartRequest {
  context: ExtensionRuntimeLaunchContext
  sessionId: string
}

export type ExtensionRuntimeSessionKind = "ambient" | "foreground" | "run-once"

export interface ExtensionRuntimeSessionInfo {
  context: ExtensionRuntimeLaunchContext
  kind: ExtensionRuntimeSessionKind
  pid?: number
  sessionId: string
}

export interface ExtensionRuntimeSessionError {
  error: ExtensionRuntimeError
  sessionId: string
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

export interface ExtensionRunBotAgentSourceRef {
  id?: string
  label?: string
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
  labels?: string[]
  status?: string
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
  | ExtensionPreferencesHostRequest
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

export interface ExtensionPreferencesHostRequest extends ExtensionHostRequestBase {
  capability: "preferences"
  method: "get-command-preferences" | "get-extension-preferences"
  payload: {
    commandName?: string
    extensionName: string
  }
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
      platform: "macOS" | "Windows"
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

export interface ExtensionNavigationHostRequest extends ExtensionHostRequestBase {
  capability: "navigation"
  method: "go-home" | "hide-launcher" | "open-command"
  payload?: {
    commandName: string
    extensionName: string
    launchProps?: ExtensionRuntimeLaunchProps
    showLauncher?: boolean
  }
}

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

export type ExtensionHostToRuntimeMessage =
  | {
      context: ExtensionRuntimeLaunchContext
      runtime: ExtensionRuntimeLaunchPackageRef
      sessionId: string
      type: "start"
    }
  | { event: ExtensionRuntimeEvent; sessionId: string; type: "event" }
  | { response: ExtensionHostResponse; sessionId: string; type: "host-response" }
  | { sessionId: string; type: "stop" }

export interface ExtensionRuntimeError {
  code: string
  message: string
}

export interface ExtensionRuntimeMetrics {
  commitDurationMs?: number
  ipcLatencyMs?: number
  rendererApplyDurationMs?: number
  snapshotBytes?: number
  snapshotRevision?: number
}
