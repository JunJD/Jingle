import type { PermissionModeName, ResolvedExtensionAiCapability } from "@shared/extension-sources"
import type { ExtensionAgentToolBinding } from "../extension-tools/registry"

export interface LoadedExtensionAiCapabilitiesChange {
  aiCapabilities: ResolvedExtensionAiCapability[]
  permissionMode: PermissionModeName
  runId: string
}

export interface ExtensionAiSession {
  readonly permissionMode?: PermissionModeName
  getAiCapabilities(): ResolvedExtensionAiCapability[]
  getAllToolBindings(): ExtensionAgentToolBinding[]
  getVisibleToolBindings(): ExtensionAgentToolBinding[]
  loadAiCapability(capability: ResolvedExtensionAiCapability): void
}
