import type { AppLocale } from "./i18n"
import type { NativeMenuBarIconName } from "./native-menu-bar"

export type ExtensionRuntimeCommandMode = "menu-bar" | "no-view" | "view"

export type ExtensionRuntimeInitialAction = "focus" | "open" | "submit"

export type ExtensionRuntimeHostCapability =
  | "ai"
  | "clipboard"
  | "navigation"
  | "preferences"
  | "rpc"
  | "scheduler"
  | "settings"
  | "shell"
  | "storage"

export interface ExtensionRuntimeLaunchContext {
  commandName: string
  commandPreferences: Record<string, unknown>
  extensionName: string
  extensionPreferences: Record<string, unknown>
  initialAction: ExtensionRuntimeInitialAction
  locale: AppLocale
  mode: ExtensionRuntimeCommandMode
  seedQuery: string
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
  navigationTitle?: string
  revision: number
}

export interface ExtensionListSurfaceSnapshot extends ExtensionSurfaceBase {
  actions: ExtensionActionNode[]
  emptyView?: ExtensionListEmptyViewNode
  filtering: boolean
  isLoading: boolean
  kind: "list"
  searchBarAccessory?: ExtensionListDropdownNode
  searchBarPlaceholder?: string
  searchText: string
  sections: ExtensionListSectionNode[]
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
  title?: string
}

export interface ExtensionListDropdownNode {
  id: string
  sections: ExtensionListDropdownSectionNode[]
  value?: string
}

export interface ExtensionListDropdownSectionNode {
  id: string
  items: ExtensionListDropdownItemNode[]
  title?: string
}

export interface ExtensionListDropdownItemNode {
  title: string
  value: string
}

export interface ExtensionDetailSurfaceSnapshot extends ExtensionSurfaceBase {
  actions: ExtensionActionNode[]
  isLoading: boolean
  kind: "detail"
  markdown?: string
  metadata: ExtensionDetailMetadataNode[]
}

export interface ExtensionDetailMetadataNode {
  text: string
  title: string
}

export interface ExtensionFormSurfaceSnapshot extends ExtensionSurfaceBase {
  actions: ExtensionActionNode[]
  fields: ExtensionFormFieldNode[]
  kind: "form"
}

export type ExtensionFormFieldNode =
  | ExtensionFormCheckboxFieldNode
  | ExtensionFormDropdownFieldNode
  | ExtensionFormMessageNode
  | ExtensionFormSeparatorNode
  | ExtensionFormTextAreaFieldNode
  | ExtensionFormTextFieldNode

export interface ExtensionFormFieldBase {
  description?: string
  id: string
  title: string
}

export interface ExtensionFormTextFieldNode extends ExtensionFormFieldBase {
  kind: "text-field"
  placeholder?: string
  value: string
}

export interface ExtensionFormTextAreaFieldNode extends ExtensionFormFieldBase {
  kind: "text-area"
  placeholder?: string
  value: string
}

export interface ExtensionFormCheckboxFieldNode extends ExtensionFormFieldBase {
  kind: "checkbox"
  label?: string
  value: boolean
}

export interface ExtensionFormDropdownFieldNode extends ExtensionFormFieldBase {
  items: ExtensionFormDropdownItemNode[]
  kind: "dropdown"
  value: string
}

export interface ExtensionFormDropdownItemNode {
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
  iconName?: NativeMenuBarIconName
  id: string
  subtitle?: string
  title: string
}

export interface ExtensionErrorSurfaceSnapshot extends ExtensionSurfaceBase {
  description?: string
  kind: "error"
  title: string
}

export interface ExtensionActionNode {
  disabled: boolean
  icon?: ExtensionVisualNode
  id: string
  sectionTitle?: string
  style: ExtensionActionStyle
  title: string
}

export type ExtensionActionStyle = "destructive" | "regular"

export type ExtensionVisualNode =
  | ExtensionInlineVisualNode
  | ExtensionSvgVisualNode
  | ExtensionTextVisualNode

export interface ExtensionTextVisualNode {
  kind: "text"
  text: string
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
  | { actionId: string; revision: number; type: "action.execute" }
  | { changeId: string; fieldId: string; type: "form.field.change"; value: boolean | string }
  | { query: string; type: "list.query.change" }
  | { type: "list.dropdown.change"; value: string }
  | { itemId: string; type: "menu-bar.item.execute" }
  | { type: "navigation.pop" }

export type ExtensionHostRequest =
  | ExtensionAiHostRequest
  | ExtensionClipboardHostRequest
  | ExtensionNavigationHostRequest
  | ExtensionOpenExternalHostRequest
  | ExtensionPreferencesHostRequest
  | ExtensionRpcHostRequest
  | ExtensionSchedulerHostRequest
  | ExtensionSettingsHostRequest
  | ExtensionStorageHostRequest

export interface ExtensionHostRequestBase {
  id: string
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

export interface ExtensionStorageHostRequest extends ExtensionHostRequestBase {
  capability: "storage"
  method: "get" | "set"
  payload: {
    key: string
    value?: unknown
  }
}

export interface ExtensionOpenExternalHostRequest extends ExtensionHostRequestBase {
  capability: "shell"
  method: "open-external"
  payload: {
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

export interface ExtensionNavigationHostRequest extends ExtensionHostRequestBase {
  capability: "navigation"
  method: "go-home" | "hide-launcher" | "open-command"
  payload?: {
    commandName: string
    extensionName: string
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

export interface ExtensionClipboardHostRequest extends ExtensionHostRequestBase {
  capability: "clipboard"
  method: "write-text"
  payload: {
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
  | { context: ExtensionRuntimeLaunchContext; sessionId: string; type: "start" }
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
