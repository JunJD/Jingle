import type { PermissionModeName, ResolvedExtensionAiCapability } from "@shared/extension-sources"
import { createExtensionToolApprovalPolicyProvider } from "../extension-tools/permission"
import type { ExtensionAgentToolBinding, ExtensionToolRegistry } from "../extension-tools/registry"
import { createExtensionAiMiddleware } from "./extension-ai-middleware"

export interface CreateExtensionAiRuntimeOptions {
  aiCapabilities: ResolvedExtensionAiCapability[]
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

export function createExtensionAiRuntime(options: CreateExtensionAiRuntimeOptions) {
  const aiToolBindings = options.registry.createAiCapabilityToolBindings(options.aiCapabilities)
  const visibleAiToolBindings = aiToolBindings.filter((binding) =>
    isBindingVisibleInPermissionMode(binding, options.permissionMode)
  )
  const approvalPolicyProvider = createExtensionToolApprovalPolicyProvider({
    bindings: aiToolBindings,
    permissionMode: options.permissionMode
  })
  const middleware = createExtensionAiMiddleware({
    aiCapabilities: options.aiCapabilities,
    aiToolBindings: visibleAiToolBindings,
    permissionMode: options.permissionMode,
    runId: options.runId,
    threadId: options.threadId,
    workspacePath: options.workspacePath
  })

  return {
    aiToolBindings,
    approvalPolicyProvider,
    middleware,
    visibleAiToolBindings
  }
}
