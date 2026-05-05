import type { ExtensionPermissionDecision, PermissionModeName } from "@shared/extension-sources"
import { resolveExtensionToolPermission } from "@shared/extension-sources"
import type { ToolApprovalItem } from "@shared/tool-approval"
import { buildExtensionToolApprovalItem } from "@shared/tool-approval"
import type { ExtensionAgentToolBinding } from "./registry"

export interface ExtensionToolApprovalPolicy {
  binding: ExtensionAgentToolBinding
  decision: ExtensionPermissionDecision
}

export interface ExtensionToolApprovalPolicyProvider {
  getPolicy: (agentToolName: string) => ExtensionToolApprovalPolicy | null
  getReview: (agentToolName: string, args: Record<string, unknown>) => ToolApprovalItem | null
}

export function createExtensionToolApprovalPolicyProvider(input: {
  bindings: ExtensionAgentToolBinding[]
  permissionMode?: PermissionModeName
}): ExtensionToolApprovalPolicyProvider {
  const bindingsByAgentToolName = new Map(
    input.bindings.map((binding) => [binding.agentToolName, binding])
  )

  return {
    getPolicy: (agentToolName) => {
      const binding = bindingsByAgentToolName.get(agentToolName)
      if (!binding) {
        return null
      }

      const mode = input.permissionMode ?? binding.profile.defaultPermissionMode
      return {
        binding,
        decision: resolveExtensionToolPermission({
          access: binding.definition.access,
          approval: binding.definition.approval,
          mode
        })
      }
    },
    getReview: (agentToolName, args) => {
      const policy = bindingsByAgentToolName.get(agentToolName)
      if (!policy) {
        return null
      }

      const mode = input.permissionMode ?? policy.profile.defaultPermissionMode
      const decision = resolveExtensionToolPermission({
        access: policy.definition.access,
        approval: policy.definition.approval,
        mode
      })

      return buildExtensionToolApprovalItem(
        {
          access: policy.definition.access,
          approval: decision.approval,
          extensionName: policy.definition.extensionName,
          permissionMode: mode,
          reason: decision.reason,
          sourceDisplayName: policy.profile.displayName,
          sourceId: policy.source.id,
          sourceProfileId: policy.profile.id,
          toolName: agentToolName,
          toolTitle: policy.display.title
        },
        args
      )
    }
  }
}
