import type {
  ExtensionAiCapabilityCatalogItem,
  ResolvedExtensionAiCapability
} from "@shared/extension-sources"
import type { NativeExtensionExecutionContext } from "@shared/native-extensions"
import { createDynamicExtensionToolApprovalPolicyProvider } from "../extension-tools/permission"
import type { ExtensionAgentToolBinding, ExtensionToolRegistry } from "../extension-tools/registry"
import { createExtensionAiToolsPortOptions } from "./extension-ai-tools-port"
import type {
  ExtensionAiSession,
  LoadedExtensionAiCapabilitiesChange
} from "./extension-ai-session"

export interface CreateExtensionAiRuntimeOptions {
  aiCapabilities: ResolvedExtensionAiCapability[]
  aiCapabilityCatalog?: ExtensionAiCapabilityCatalogItem[]
  getAiCapabilityByExtensionName?: (extensionName: string) => ResolvedExtensionAiCapability | null
  getExtensionExecutionContext?: (extensionName: string) => NativeExtensionExecutionContext
  getExtensionPreferences?: (extensionName: string) => Record<string, unknown>
  onLoadedAiCapabilitiesChanged?: (
    change: LoadedExtensionAiCapabilitiesChange
  ) => Promise<void> | void
  registry: ExtensionToolRegistry
  runId?: string | null
  threadId: string
  workspacePath: string
}

function isBindingVisibleInPermissionMode(binding: ExtensionAgentToolBinding): boolean {
  const mode = binding.resolvedCapability.permissionMode
  return mode !== "explore" || binding.definition.access === "read"
}

function buildCapabilityKey(capability: ResolvedExtensionAiCapability): string {
  return `${capability.extensionName}:${capability.capability.id}`
}

export function createExtensionAiSession(input: {
  aiCapabilities: ResolvedExtensionAiCapability[]
  registry: ExtensionToolRegistry
}): ExtensionAiSession {
  const loadedCapabilitiesByKey = new Map<string, ResolvedExtensionAiCapability>()
  const allToolBindingsByName = new Map<string, ExtensionAgentToolBinding>()
  const agentToolNamesByCapabilityKey = new Map<string, Set<string>>()

  function loadAiCapability(capability: ResolvedExtensionAiCapability): void {
    const capabilityKey = buildCapabilityKey(capability)
    const previousAgentToolNames = agentToolNamesByCapabilityKey.get(capabilityKey)
    if (previousAgentToolNames) {
      for (const agentToolName of previousAgentToolNames) {
        allToolBindingsByName.delete(agentToolName)
      }
    }

    loadedCapabilitiesByKey.set(capabilityKey, capability)
    const nextAgentToolNames = new Set<string>()
    for (const binding of input.registry.createAiCapabilityToolBindings([capability])) {
      allToolBindingsByName.set(binding.agentToolName, binding)
      nextAgentToolNames.add(binding.agentToolName)
    }
    agentToolNamesByCapabilityKey.set(capabilityKey, nextAgentToolNames)
  }

  for (const capability of input.aiCapabilities) {
    loadAiCapability(capability)
  }

  return {
    getAiCapabilities: () => Array.from(loadedCapabilitiesByKey.values()),
    getAllToolBindings: () => Array.from(allToolBindingsByName.values()),
    getVisibleToolBindings: () =>
      Array.from(allToolBindingsByName.values()).filter((binding) =>
        isBindingVisibleInPermissionMode(binding)
      ),
    loadAiCapability
  }
}

export function createExtensionAiRuntime(options: CreateExtensionAiRuntimeOptions) {
  const session = createExtensionAiSession({
    aiCapabilities: options.aiCapabilities,
    registry: options.registry
  })
  const approvalPolicyProvider = createDynamicExtensionToolApprovalPolicyProvider({
    getExtensionExecutionContext: options.getExtensionExecutionContext,
    getExtensionPreferences: options.getExtensionPreferences,
    getBindings: session.getAllToolBindings
  })
  return {
    get aiToolBindings() {
      return session.getAllToolBindings()
    },
    approvalPolicyProvider,
    createToolsOptions(input: { runId: string; threadId: string; workspacePath: string }) {
      return createExtensionAiToolsPortOptions({
        aiCapabilityCatalog: options.aiCapabilityCatalog ?? [],
        getAiCapabilityByExtensionName: options.getAiCapabilityByExtensionName,
        getExtensionExecutionContext: options.getExtensionExecutionContext,
        getExtensionPreferences: options.getExtensionPreferences,
        onLoadedAiCapabilitiesChanged: options.onLoadedAiCapabilitiesChanged,
        runId: input.runId,
        session,
        threadId: input.threadId,
        workspacePath: input.workspacePath
      })
    },
    session,
    get visibleAiToolBindings() {
      return session.getVisibleToolBindings()
    }
  }
}
