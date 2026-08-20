import type * as CommonProtocol from "@jingle/extension-api/host-runtime"

export const EXTENSION_RUNTIME_VM_MODULE_EXEC_ARGV = Object.freeze([
  "--experimental-vm-modules"
] as const)

export {
  normalizeExtensionAiAskPayload,
  normalizeExtensionAiHostRequest,
  normalizeExtensionRuntimeJsonFact,
  normalizeExtensionRuntimeErrorDetails,
  normalizeExtensionRuntimeLaunchIntent,
  normalizeExtensionRuntimeLaunchProps,
  normalizeExtensionRuntimeNavigationHostRequest,
  normalizeExtensionRuntimeNavigationRequestEvent,
  normalizeExtensionRuntimeStartRequest,
  resolveExtensionShortcutPlatform
} from "../../packages/extension-api/src/shared/extension-runtime-protocol"

export type ExtensionRuntimeCommandMode = CommonProtocol.ExtensionRuntimeCommandMode
export type ExtensionRuntimeInitialAction = CommonProtocol.ExtensionRuntimeInitialAction
export type ExtensionRuntimeJsonValue = CommonProtocol.ExtensionRuntimeJsonValue
export type ExtensionRuntimeJsonObject = CommonProtocol.ExtensionRuntimeJsonObject
export type ExtensionRuntimeJsonArray = CommonProtocol.ExtensionRuntimeJsonArray
export type ExtensionRuntimeLaunchProps = CommonProtocol.ExtensionRuntimeLaunchProps
export type ExtensionRuntimeLaunchIntent = CommonProtocol.ExtensionRuntimeLaunchIntent
export type ExtensionRuntimeHostCapability = CommonProtocol.ExtensionRuntimeHostCapability
export type ExtensionRuntimeStorageScope = CommonProtocol.ExtensionRuntimeStorageScope
export type ExtensionRuntimeLocalStorageIdentity =
  CommonProtocol.ExtensionRuntimeLocalStorageIdentity
export type ExtensionRuntimeAvailableCacheIdentity =
  CommonProtocol.ExtensionRuntimeAvailableCacheIdentity
export type ExtensionRuntimeCacheIdentity = CommonProtocol.ExtensionRuntimeCacheIdentity
export type ExtensionRuntimeUnavailableCacheIdentity =
  CommonProtocol.ExtensionRuntimeUnavailableCacheIdentity
export type ExtensionRuntimeDataIdentity = CommonProtocol.ExtensionRuntimeDataIdentity
export type ExtensionRuntimeDataIdentityState = CommonProtocol.ExtensionRuntimeDataIdentityState
export type ExtensionRuntimeUnavailableDataIdentity =
  CommonProtocol.ExtensionRuntimeUnavailableDataIdentity
export type ExtensionRuntimeLaunchContext = CommonProtocol.ExtensionRuntimeLaunchContext

export type ExtensionRuntimeLaunchPackageRef =
  | {
      extensionName: string
      kind: "built-in"
      version: string
    }
  | {
      expectedRuntimeArtifactRevision: `sha256:${string}`
      extensionName: string
      kind: "module"
      modulePath: string
      version: string
    }

export type ExtensionRuntimeForegroundStartRequest = CommonProtocol.ExtensionRuntimeStartRequest

export type ExtensionRuntimeRunOnceRequest = CommonProtocol.ExtensionRuntimeStartRequest

export type ExtensionRuntimeSessionKind = CommonProtocol.ExtensionRuntimeSessionKind

export interface ExtensionRuntimeSessionInfo {
  intent: ExtensionRuntimeLaunchIntent
  kind: ExtensionRuntimeSessionKind
  sessionId: string
}

export type ExtensionRuntimeSessionError = CommonProtocol.ExtensionRuntimeSessionError
export type ExtensionRuntimeErrorDetails = CommonProtocol.ExtensionRuntimeErrorDetails
export type ExtensionRuntimeStorageLegacyUnownedErrorDetails =
  CommonProtocol.ExtensionRuntimeStorageLegacyUnownedErrorDetails
export type ExtensionRuntimeStorageIssueRecovery =
  CommonProtocol.ExtensionRuntimeStorageIssueRecovery
export type ExtensionRuntimeRecoverableIssue = CommonProtocol.ExtensionRuntimeRecoverableIssue
export type ExtensionRuntimeSessionIssueSnapshot =
  CommonProtocol.ExtensionRuntimeSessionIssueSnapshot
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
export type ExtensionShortcutPlatform = CommonProtocol.ExtensionShortcutPlatform

export type ExtensionRunBotAgentSourceRef = CommonProtocol.ExtensionRunBotAgentSourceRef
export type ExtensionRunBotAgentPromptPlan = CommonProtocol.ExtensionRunBotAgentPromptPlan
export type ExtensionRunBotAgentWorkflow = CommonProtocol.ExtensionRunBotAgentWorkflow
export type ExtensionRunBotAgentWorkflowLabel = CommonProtocol.ExtensionRunBotAgentWorkflowLabel
export type ExtensionRunBotAgentPayload = CommonProtocol.ExtensionRunBotAgentPayload
export type ExtensionRuntimeRunBotAgentRequestEvent =
  CommonProtocol.ExtensionRuntimeRunBotAgentRequestEvent
export type ExtensionRuntimeRunBotAgentResponse = CommonProtocol.ExtensionRuntimeRunBotAgentResponse

export type ExtensionVisualNode = CommonProtocol.ExtensionVisualNode
export type ExtensionTextVisualNode = CommonProtocol.ExtensionTextVisualNode
export type ExtensionImageVisualNode = CommonProtocol.ExtensionImageVisualNode
export type ExtensionInlineVisualNode = CommonProtocol.ExtensionInlineVisualNode
export type ExtensionSvgVisualNode = CommonProtocol.ExtensionSvgVisualNode
export type ExtensionSvgProps = CommonProtocol.ExtensionSvgProps
export type ExtensionRuntimeEvent = CommonProtocol.ExtensionRuntimeEvent

export type ExtensionHostRequest = CommonProtocol.ExtensionHostRequest

export type ExtensionHostRequestBase = CommonProtocol.ExtensionHostRequestBase

export type ExtensionAgentHostRequest = CommonProtocol.ExtensionAgentHostRequest

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
export type ExtensionRuntimeNavigationRequestEvent =
  CommonProtocol.ExtensionRuntimeNavigationRequestEvent
export type ExtensionRuntimeEventAck = CommonProtocol.ExtensionRuntimeEventAck
export type ExtensionRuntimeNavigationResponse = CommonProtocol.ExtensionRuntimeNavigationResponse
export type ExtensionClipboardHostRequest = CommonProtocol.ExtensionClipboardHostRequest
export type ExtensionClipboardReadTextHostRequest =
  CommonProtocol.ExtensionClipboardReadTextHostRequest
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

export type ExtensionRuntimeToHostMessage = CommonProtocol.ExtensionRuntimeToHostMessage

export interface ExtensionRuntimeUtilityExecutionLease {
  context: ExtensionRuntimeLaunchContext
  runtime: ExtensionRuntimeLaunchPackageRef
}

export type ExtensionRuntimeCacheExecutionIdentity =
  | (ExtensionRuntimeAvailableCacheIdentity & ExtensionRuntimeLocalStorageIdentity)
  | { kind: "unavailable" }

export interface ExtensionRuntimeCacheExecutionPrincipal {
  commandName: string
  extensionName: string
  identity: ExtensionRuntimeCacheExecutionIdentity
}

export interface ExtensionRuntimeCacheWriterLease {
  principal: ExtensionRuntimeCacheExecutionPrincipal
  sessionId: string
  token: string
}

const EXTENSION_RUNTIME_CACHE_WRITER_SESSION_ID_MAX_LENGTH = 128
const EXTENSION_RUNTIME_CACHE_PRINCIPAL_STRING_MAX_LENGTH = 256
const EXTENSION_RUNTIME_CACHE_WRITER_TOKEN_PATTERN = /^[a-f0-9]{64}$/
const EXTENSION_RUNTIME_CACHE_ARTIFACT_REVISION_PATTERN = /^sha256:[a-f0-9]{64}$/

export function createExtensionRuntimeCacheExecutionPrincipal(
  context: ExtensionRuntimeLaunchContext
): ExtensionRuntimeCacheExecutionPrincipal {
  const identity = context.dataIdentity
  return normalizeExtensionRuntimeCacheExecutionPrincipal({
    commandName: context.commandName,
    extensionName: context.extensionName,
    identity:
      identity.kind === "available" && identity.cache.kind === "available"
        ? {
            ...identity.localStorage,
            ...identity.cache
          }
        : { kind: "unavailable" }
  })
}

export function normalizeExtensionRuntimeCacheExecutionPrincipal(
  value: unknown
): ExtensionRuntimeCacheExecutionPrincipal {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Extension runtime cache execution principal is invalid.")
  }
  const principal = value as Record<string, unknown>
  if (Object.keys(principal).length !== 3) {
    throw new Error("Extension runtime cache execution principal is invalid.")
  }
  const commandName = normalizeExtensionRuntimeCachePrincipalString(principal.commandName)
  const extensionName = normalizeExtensionRuntimeCachePrincipalString(principal.extensionName)
  const identity = normalizeExtensionRuntimeCacheExecutionIdentity(principal.identity)
  return Object.freeze({ commandName, extensionName, identity })
}

export function assertExtensionRuntimeCacheWriterLeaseOwnsExecution(
  lease: ExtensionRuntimeCacheWriterLease,
  execution: ExtensionRuntimeUtilityExecutionLease
): void {
  const normalizedLease = normalizeExtensionRuntimeCacheWriterLease(lease)
  const expected = createExtensionRuntimeCacheExecutionPrincipal(execution.context)
  if (JSON.stringify(normalizedLease.principal) !== JSON.stringify(expected)) {
    throw new Error("Extension runtime cache writer principal does not own this execution.")
  }
}

export function normalizeExtensionRuntimeCacheWriterLease(
  value: unknown
): ExtensionRuntimeCacheWriterLease {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Extension runtime cache writer lease is invalid.")
  }
  const lease = value as Record<string, unknown>
  if (
    Object.keys(lease).length !== 3 ||
    typeof lease.sessionId !== "string" ||
    lease.sessionId.length === 0 ||
    lease.sessionId.length > EXTENSION_RUNTIME_CACHE_WRITER_SESSION_ID_MAX_LENGTH ||
    typeof lease.token !== "string" ||
    !EXTENSION_RUNTIME_CACHE_WRITER_TOKEN_PATTERN.test(lease.token)
  ) {
    throw new Error("Extension runtime cache writer lease is invalid.")
  }
  return Object.freeze({
    principal: normalizeExtensionRuntimeCacheExecutionPrincipal(lease.principal),
    sessionId: lease.sessionId,
    token: lease.token
  })
}

function normalizeExtensionRuntimeCacheExecutionIdentity(
  value: unknown
): ExtensionRuntimeCacheExecutionIdentity {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Extension runtime cache execution principal is invalid.")
  }
  const identity = value as Record<string, unknown>
  if (identity.kind === "unavailable") {
    if (Object.keys(identity).length !== 1) {
      throw new Error("Extension runtime cache execution principal is invalid.")
    }
    return Object.freeze({ kind: "unavailable" })
  }
  if (
    identity.kind !== "available" ||
    Object.keys(identity).length !== 8 ||
    !isExtensionRuntimeCacheGeneration(identity.commandConfigGeneration) ||
    !isExtensionRuntimeCacheGeneration(identity.connectionConfigGeneration) ||
    !isExtensionRuntimeCacheGeneration(identity.credentialGeneration) ||
    !isExtensionRuntimeCacheGeneration(identity.extensionConfigGeneration) ||
    typeof identity.runtimeArtifactRevision !== "string" ||
    !EXTENSION_RUNTIME_CACHE_ARTIFACT_REVISION_PATTERN.test(identity.runtimeArtifactRevision)
  ) {
    throw new Error("Extension runtime cache execution principal is invalid.")
  }
  const connectionId = normalizeExtensionRuntimeCachePrincipalString(identity.connectionId)
  const runtimePackageRevision = normalizeExtensionRuntimeCachePrincipalString(
    identity.runtimePackageRevision
  )
  return Object.freeze({
    commandConfigGeneration: identity.commandConfigGeneration,
    connectionConfigGeneration: identity.connectionConfigGeneration,
    connectionId,
    credentialGeneration: identity.credentialGeneration,
    extensionConfigGeneration: identity.extensionConfigGeneration,
    kind: "available",
    runtimeArtifactRevision: identity.runtimeArtifactRevision,
    runtimePackageRevision
  })
}

function normalizeExtensionRuntimeCachePrincipalString(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > EXTENSION_RUNTIME_CACHE_PRINCIPAL_STRING_MAX_LENGTH
  ) {
    throw new Error("Extension runtime cache execution principal is invalid.")
  }
  return value
}

function isExtensionRuntimeCacheGeneration(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0
}

export type ExtensionHostToRuntimeMessage =
  | {
      lease: ExtensionRuntimeUtilityExecutionLease
      sessionId: string
      type: "start"
    }
  | { event: ExtensionRuntimeEvent; sessionId: string; type: "event" }
  | { response: ExtensionHostResponse; sessionId: string; type: "host-response" }
  | { sessionId: string; type: "stop" }

export type ExtensionRuntimeError = CommonProtocol.ExtensionRuntimeError
export type ExtensionRuntimeMetrics = CommonProtocol.ExtensionRuntimeMetrics
