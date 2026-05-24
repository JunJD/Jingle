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
  getCallToolPolicy: (
    args: Record<string, unknown>
  ) => (ExtensionToolApprovalPolicy & { toolArgs: Record<string, unknown> }) | null
  getReview: (binding: ExtensionAgentToolBinding, args: Record<string, unknown>) => ToolApprovalItem
}

export function createDynamicExtensionToolApprovalPolicyProvider(input: {
  getBindings: () => ExtensionAgentToolBinding[]
  permissionMode?: PermissionModeName
}): ExtensionToolApprovalPolicyProvider {
  function getBindingForExtensionToolCall(
    args: Record<string, unknown>
  ): { binding: ExtensionAgentToolBinding; toolArgs: Record<string, unknown> } | null {
    const extensionName = typeof args.extensionName === "string" ? args.extensionName.trim() : ""
    const toolName = typeof args.toolName === "string" ? args.toolName.trim() : ""
    if (!extensionName || !toolName) {
      return null
    }

    const binding =
      input
        .getBindings()
        .find(
          (entry) =>
            entry.resolvedCapability.extensionName === extensionName &&
            (entry.definition.name === toolName || entry.agentToolName === toolName)
        ) ?? null
    if (!binding) {
      return null
    }

    const rawToolArgs = args.args
    return {
      binding,
      toolArgs:
        rawToolArgs && typeof rawToolArgs === "object" && !Array.isArray(rawToolArgs)
          ? (rawToolArgs as Record<string, unknown>)
          : {}
    }
  }

  function buildPolicy(
    binding: ExtensionAgentToolBinding
  ): ExtensionToolApprovalPolicy {
    const mode = input.permissionMode ?? binding.resolvedCapability.permissionMode
    return {
      binding,
      decision: resolveExtensionToolPermission({
        access: binding.definition.access,
        mode
      })
    }
  }

  function buildReview(
    binding: ExtensionAgentToolBinding,
    args: Record<string, unknown>
  ): ToolApprovalItem {
    const mode = input.permissionMode ?? binding.resolvedCapability.permissionMode
    const decision = resolveExtensionToolPermission({
      access: binding.definition.access,
      mode
    })

    return buildExtensionToolApprovalItem(
      {
        access: binding.definition.access,
        capabilityDisplayName: binding.resolvedCapability.displayName,
        capabilityId: binding.capability.id,
        extensionName: binding.definition.extensionName,
        permissionMode: mode,
        reason: decision.reason,
        toolName: binding.agentToolName,
        toolTitle: binding.display.title
      },
      args
    )
  }

  return {
    getCallToolPolicy: (args) => {
      const resolved = getBindingForExtensionToolCall(args)
      if (!resolved) {
        return null
      }

      return {
        ...buildPolicy(resolved.binding),
        toolArgs: resolved.toolArgs
      }
    },
    getReview: buildReview
  }
}
