import type * as CommonProtocol from "@jingle/extension-api/host-runtime"

export type ExtensionRuntimeCommandMode = CommonProtocol.ExtensionRuntimeCommandMode
export type ExtensionRuntimeInitialAction = CommonProtocol.ExtensionRuntimeInitialAction
export type ExtensionRuntimeLaunchProps = CommonProtocol.ExtensionRuntimeLaunchProps
export type ExtensionRuntimeHostCapability = CommonProtocol.ExtensionRuntimeHostCapability
export type ExtensionRuntimeStorageScope = CommonProtocol.ExtensionRuntimeStorageScope
export type ExtensionRuntimeLaunchContext = CommonProtocol.ExtensionRuntimeLaunchContext

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

export type ExtensionRuntimeSessionKind = CommonProtocol.ExtensionRuntimeSessionKind

export interface ExtensionRuntimeSessionInfo {
  context: ExtensionRuntimeLaunchContext
  kind: ExtensionRuntimeSessionKind
  pid?: number
  sessionId: string
}

export type ExtensionRuntimeSessionError = CommonProtocol.ExtensionRuntimeSessionError
export type ExtensionRuntimeRunResult = CommonProtocol.ExtensionRuntimeRunResult
export type ExtensionSurfaceSnapshot = CommonProtocol.ExtensionSurfaceSnapshot
export type ExtensionSurfaceBase = CommonProtocol.ExtensionSurfaceBase
export type ExtensionListSurfaceSnapshot = CommonProtocol.ExtensionListSurfaceSnapshot
export type ExtensionListPaginationNode = CommonProtocol.ExtensionListPaginationNode
export type ExtensionListSectionNode = CommonProtocol.ExtensionListSectionNode
export type ExtensionListItemNode = CommonProtocol.ExtensionListItemNode
export type ExtensionListEmptyViewNode = CommonProtocol.ExtensionListEmptyViewNode
export type ExtensionListDropdownNode = CommonProtocol.ExtensionListDropdownNode
export type ExtensionListDropdownSectionNode = CommonProtocol.ExtensionListDropdownSectionNode
export type ExtensionListDropdownItemNode = CommonProtocol.ExtensionListDropdownItemNode
export type ExtensionDetailSurfaceSnapshot = CommonProtocol.ExtensionDetailSurfaceSnapshot
export type ExtensionDetailMetadataNode = CommonProtocol.ExtensionDetailMetadataNode
export type ExtensionFormSurfaceSnapshot = CommonProtocol.ExtensionFormSurfaceSnapshot
export type ExtensionFormFieldNode = CommonProtocol.ExtensionFormFieldNode
export type ExtensionFormFieldBase = CommonProtocol.ExtensionFormFieldBase
export type ExtensionFormTextFieldNode = CommonProtocol.ExtensionFormTextFieldNode
export type ExtensionFormTextAreaFieldNode = CommonProtocol.ExtensionFormTextAreaFieldNode
export type ExtensionFormCheckboxFieldNode = CommonProtocol.ExtensionFormCheckboxFieldNode
export type ExtensionFormDatePickerFieldNode = CommonProtocol.ExtensionFormDatePickerFieldNode
export type ExtensionFormDropdownFieldNode = CommonProtocol.ExtensionFormDropdownFieldNode
export type ExtensionFormDropdownItemNode = CommonProtocol.ExtensionFormDropdownItemNode
export type ExtensionFormTagPickerFieldNode = CommonProtocol.ExtensionFormTagPickerFieldNode
export type ExtensionFormTagPickerItemNode = CommonProtocol.ExtensionFormTagPickerItemNode
export type ExtensionFormMessageNode = CommonProtocol.ExtensionFormMessageNode
export type ExtensionFormSeparatorNode = CommonProtocol.ExtensionFormSeparatorNode
export type ExtensionMenuBarSurfaceSnapshot = CommonProtocol.ExtensionMenuBarSurfaceSnapshot
export type ExtensionMenuBarSectionNode = CommonProtocol.ExtensionMenuBarSectionNode
export type ExtensionMenuBarItemNode = CommonProtocol.ExtensionMenuBarItemNode
export type ExtensionErrorSurfaceSnapshot = CommonProtocol.ExtensionErrorSurfaceSnapshot
export type ExtensionActionNode = CommonProtocol.ExtensionActionNode
export type ExtensionActionStyle = CommonProtocol.ExtensionActionStyle
export type ExtensionActionShortcutNode = CommonProtocol.ExtensionActionShortcutNode

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

export type ExtensionVisualNode = CommonProtocol.ExtensionVisualNode
export type ExtensionTextVisualNode = CommonProtocol.ExtensionTextVisualNode
export type ExtensionImageVisualNode = CommonProtocol.ExtensionImageVisualNode
export type ExtensionInlineVisualNode = CommonProtocol.ExtensionInlineVisualNode
export type ExtensionSvgVisualNode = CommonProtocol.ExtensionSvgVisualNode
export type ExtensionSvgProps = CommonProtocol.ExtensionSvgProps
export type ExtensionRuntimeEvent = CommonProtocol.ExtensionRuntimeEvent

export type ExtensionHostRequest =
  | Exclude<CommonProtocol.ExtensionHostRequest, { capability: "agent" }>
  | ExtensionAgentHostRequest

export type ExtensionHostRequestBase = CommonProtocol.ExtensionHostRequestBase

export interface ExtensionAgentHostRequest extends ExtensionHostRequestBase {
  capability: "agent"
  method: "run-bot-agent"
  payload: ExtensionRunBotAgentPayload
}

export type ExtensionPreferencesHostRequest = CommonProtocol.ExtensionPreferencesHostRequest
export type ExtensionRpcHostRequest = CommonProtocol.ExtensionRpcHostRequest
export type ExtensionStorageHostRequest = CommonProtocol.ExtensionStorageHostRequest
export type ExtensionStorageGetHostRequest = CommonProtocol.ExtensionStorageGetHostRequest
export type ExtensionStorageSetHostRequest = CommonProtocol.ExtensionStorageSetHostRequest
export type ExtensionStorageRemoveHostRequest = CommonProtocol.ExtensionStorageRemoveHostRequest
export type ExtensionStorageAllItemsHostRequest = CommonProtocol.ExtensionStorageAllItemsHostRequest
export type ExtensionStorageClearHostRequest = CommonProtocol.ExtensionStorageClearHostRequest
export type ExtensionOpenExternalHostRequest = CommonProtocol.ExtensionOpenExternalHostRequest
export type ExtensionSettingsHostRequest = CommonProtocol.ExtensionSettingsHostRequest
export type ExtensionQuicklinksHostRequest = CommonProtocol.ExtensionQuicklinksHostRequest
export type ExtensionToastStyle = CommonProtocol.ExtensionToastStyle
export type ExtensionToastActionPayload = CommonProtocol.ExtensionToastActionPayload
export type ExtensionToastPayload = CommonProtocol.ExtensionToastPayload
export type ExtensionToastHostRequest = CommonProtocol.ExtensionToastHostRequest
export type ExtensionRuntimeToastRequestEvent = CommonProtocol.ExtensionRuntimeToastRequestEvent
export type ExtensionAlertActionStyle = CommonProtocol.ExtensionAlertActionStyle
export type ExtensionAlertActionPayload = CommonProtocol.ExtensionAlertActionPayload
export type ExtensionConfirmAlertPayload = CommonProtocol.ExtensionConfirmAlertPayload
export type ExtensionDialogHostRequest = CommonProtocol.ExtensionDialogHostRequest
export type ExtensionNavigationHostRequest = CommonProtocol.ExtensionNavigationHostRequest
export type ExtensionRuntimeNavigationRequestEvent = CommonProtocol.ExtensionRuntimeNavigationRequestEvent
export type ExtensionRuntimeEventAck = CommonProtocol.ExtensionRuntimeEventAck
export type ExtensionRuntimeNavigationResponse = CommonProtocol.ExtensionRuntimeNavigationResponse
export type ExtensionClipboardHostRequest = CommonProtocol.ExtensionClipboardHostRequest
export type ExtensionClipboardReadTextHostRequest = CommonProtocol.ExtensionClipboardReadTextHostRequest
export type ExtensionClipboardReadSelectedTextHostRequest =
  CommonProtocol.ExtensionClipboardReadSelectedTextHostRequest
export type ExtensionClipboardWriteTextHostRequest =
  CommonProtocol.ExtensionClipboardWriteTextHostRequest
export type ExtensionClipboardPasteTextHostRequest =
  CommonProtocol.ExtensionClipboardPasteTextHostRequest
export type ExtensionSchedulerHostRequest = CommonProtocol.ExtensionSchedulerHostRequest
export type ExtensionAiHostRequest = CommonProtocol.ExtensionAiHostRequest
export type ExtensionAiAskPayload = CommonProtocol.ExtensionAiAskPayload
export type ExtensionHostResponse = CommonProtocol.ExtensionHostResponse

export type ExtensionRuntimeToHostMessage =
  | Exclude<CommonProtocol.ExtensionRuntimeToHostMessage, { type: "host-request" }>
  | { request: ExtensionHostRequest; sessionId: string; type: "host-request" }

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

export type ExtensionRuntimeError = CommonProtocol.ExtensionRuntimeError
export type ExtensionRuntimeMetrics = CommonProtocol.ExtensionRuntimeMetrics
