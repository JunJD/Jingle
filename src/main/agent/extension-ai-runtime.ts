import type {
  ExtensionAiCapabilityCatalogItem,
  PermissionModeName,
  ResolvedExtensionAiCapability
} from "@shared/extension-sources"
import type { NativeExtensionExecutionContext } from "@shared/native-extensions"
import { createDynamicExtensionToolApprovalPolicyProvider } from "../extension-tools/permission"
import type { ExtensionAgentToolBinding, ExtensionToolRegistry } from "../extension-tools/registry"
import { createExtensionAiMiddleware } from "./extension-ai-middleware"
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
  permissionMode?: PermissionModeName
  registry: ExtensionToolRegistry
  runId?: string | null
  threadId: string
  workspacePath: string
}

function isBindingVisibleInPermissionMode(
  binding: ExtensionAgentToolBinding,
  permissionMode?: PermissionModeName
): boolean {
  const mode = permissionMode ?? binding.resolvedCapability.permissionMode
  return mode !== "explore" || binding.definition.access === "read"
}

function buildCapabilityKey(capability: ResolvedExtensionAiCapability): string {
  return `${capability.extensionName}:${capability.capability.id}`
}

export function createExtensionAiSession(input: {
  aiCapabilities: ResolvedExtensionAiCapability[]
  permissionMode?: PermissionModeName
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
    permissionMode: input.permissionMode,
    getAiCapabilities: () => Array.from(loadedCapabilitiesByKey.values()),
    getAllToolBindings: () => Array.from(allToolBindingsByName.values()),
    getVisibleToolBindings: () =>
      Array.from(allToolBindingsByName.values()).filter((binding) =>
        isBindingVisibleInPermissionMode(binding, input.permissionMode)
      ),
    loadAiCapability
  }
}

export function createExtensionAiRuntime(options: CreateExtensionAiRuntimeOptions) {
  const session = createExtensionAiSession({
    aiCapabilities: options.aiCapabilities,
    permissionMode: options.permissionMode,
    registry: options.registry
  })
  const approvalPolicyProvider = createDynamicExtensionToolApprovalPolicyProvider({
    getExtensionExecutionContext: options.getExtensionExecutionContext,
    getExtensionPreferences: options.getExtensionPreferences,
    getBindings: session.getAllToolBindings,
    permissionMode: options.permissionMode
  })
  const middleware = createExtensionAiMiddleware({
    aiCapabilityCatalog: options.aiCapabilityCatalog ?? [],
    getAiCapabilityByExtensionName: options.getAiCapabilityByExtensionName,
    getExtensionExecutionContext: options.getExtensionExecutionContext,
    getExtensionPreferences: options.getExtensionPreferences,
    onLoadedAiCapabilitiesChanged: options.onLoadedAiCapabilitiesChanged,
    permissionMode: options.permissionMode,
    runId: options.runId,
    session,
    threadId: options.threadId,
    workspacePath: options.workspacePath
  })

  return {
    get aiToolBindings() {
      return session.getAllToolBindings()
    },
    approvalPolicyProvider,
    middleware,
    session,
    get visibleAiToolBindings() {
      return session.getVisibleToolBindings()
    }
  }
}
