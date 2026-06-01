export * from "./extension-runtime/sdk"
export { defineNativeExtensionService } from "./main"

export {
  defineNativeExtensionMain,
  defineNativeExtensionManifest
} from "./shared/native-extensions"
export type {
  InstalledNativeExtensionSettingsSchema,
  NativeExtensionAiCapability,
  NativeExtensionCommandArgumentSchema,
  NativeExtensionCommandManifest,
  NativeExtensionCommandMode,
  NativeExtensionCommandSettingsSchema,
  NativeExtensionConnectionAuthManifest,
  NativeExtensionConnectionManifest,
  NativeExtensionConnectionStatus,
  NativeExtensionExecutionContext,
  NativeExtensionIcon,
  NativeExtensionInvokeContext,
  NativeExtensionInvokeIpcResponse,
  NativeExtensionInvokeRequest,
  NativeExtensionMainDefinition,
  NativeExtensionOAuthRedirectManifest,
  NativeExtensionPackageManifest,
  NativeExtensionPreferenceSchema,
  NativeExtensionPreferencesChangedEvent,
  NativeExtensionPreferencesState,
  NativeExtensionResolvedConnection,
  NativeExtensionRuntimeCommandManifest,
  NativeExtensionRuntimeShellManifest,
  NativeExtensionService,
  NativeExtensionSupportedPlatform
} from "./shared/native-extensions"

export type { IpcErrorCode, IpcErrorPayload } from "./shared/ipc-error"

export type {
  ExtensionToolAccess,
  ExtensionToolApprovalDefinition,
  ExtensionToolConfirmation,
  ExtensionToolConfirmationBuilder,
  ExtensionToolConfirmationContext,
  ExtensionToolConfirmationFact,
  ExtensionToolConfirmationInfoFact,
  ExtensionToolContext,
  ExtensionToolDefinition,
  ExtensionToolSchema
} from "./shared/extension-sources"

export { defineNativeExtensionRuntime } from "./extensions/runtime-contract"
export type {
  NativeExtensionRuntimeCommandDefinition,
  NativeExtensionRuntimeCommandEntry,
  NativeExtensionRuntimeMenuBarCommandDefinition,
  NativeExtensionRuntimeMenuBarCommandEntry,
  NativeExtensionRuntimeNoViewCommandDefinition,
  NativeExtensionRuntimeNoViewCommandEntry,
  NativeExtensionRuntimeNoViewRunContext,
  NativeExtensionRuntimePackage,
  NativeExtensionRuntimeViewCommandDefinition,
  NativeExtensionRuntimeViewCommandEntry
} from "./extensions/runtime-contract"

export { defineNativeExtensionRuntimeMetadata } from "./extensions/runtime-metadata-contract"
export type {
  NativeExtensionRuntimeCommandMetadata,
  NativeExtensionRuntimePackageMetadata
} from "./extensions/runtime-metadata-contract"
