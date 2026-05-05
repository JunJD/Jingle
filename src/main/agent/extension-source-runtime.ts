import type { ExtensionSourceBinding, PermissionModeName } from "@shared/extension-sources"
import { createExtensionToolApprovalPolicyProvider } from "../extension-tools/permission"
import type { ExtensionAgentToolBinding, ExtensionToolRegistry } from "../extension-tools/registry"
import { createExtensionSourcesMiddleware } from "./extension-sources-middleware"

export interface CreateExtensionSourceRuntimeOptions {
  permissionMode?: PermissionModeName
  registry: ExtensionToolRegistry
  runId?: string | null
  sourceBindings: ExtensionSourceBinding[]
  threadId: string
  workspacePath: string
}

function isBindingVisibleInPermissionMode(
  binding: ExtensionAgentToolBinding,
  permissionMode?: PermissionModeName
): boolean {
  const mode = permissionMode ?? binding.profile.defaultPermissionMode
  return mode !== "explore" || binding.definition.access === "read"
}

export function createExtensionSourceRuntime(options: CreateExtensionSourceRuntimeOptions) {
  const sourceToolBindings = options.registry.createSourceToolBindings(options.sourceBindings)
  const visibleSourceToolBindings = sourceToolBindings.filter((binding) =>
    isBindingVisibleInPermissionMode(binding, options.permissionMode)
  )
  const approvalPolicyProvider = createExtensionToolApprovalPolicyProvider({
    bindings: sourceToolBindings,
    permissionMode: options.permissionMode
  })
  const middleware = createExtensionSourcesMiddleware({
    permissionMode: options.permissionMode,
    runId: options.runId,
    sourceBindings: options.sourceBindings,
    sourceToolBindings: visibleSourceToolBindings,
    threadId: options.threadId,
    workspacePath: options.workspacePath
  })

  return {
    approvalPolicyProvider,
    middleware,
    sourceToolBindings,
    visibleSourceToolBindings
  }
}
