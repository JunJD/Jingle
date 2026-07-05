import type { ResolvedExtensionAiCapability } from "@shared/extension-sources"
import type { ExtensionAgentToolBinding } from "../extension-tools/registry"

export interface LoadedExtensionAiCapabilitiesChange {
  aiCapabilities: ResolvedExtensionAiCapability[]
  runId: string
}

export interface ExtensionAiSession {
  getAiCapabilities(): ResolvedExtensionAiCapability[]
  getAllToolBindings(): ExtensionAgentToolBinding[]
  getVisibleToolBindings(): ExtensionAgentToolBinding[]
  loadAiCapability(capability: ResolvedExtensionAiCapability): void
}
