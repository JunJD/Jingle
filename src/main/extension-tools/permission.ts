import type {
  ExtensionPermissionDecision,
  ExtensionToolConfirmation,
  ExtensionToolConfirmationFact,
  ExtensionToolConfirmationInfoFact,
  PermissionModeName
} from "@shared/extension-sources"
import { resolveExtensionToolPermission } from "@shared/extension-sources"
import type { NativeExtensionExecutionContext } from "@shared/native-extensions"
import type { ToolApprovalConfirmation, ToolApprovalItem } from "@shared/tool-approval"
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
  getReview: (
    binding: ExtensionAgentToolBinding,
    args: Record<string, unknown>
  ) => Promise<ToolApprovalItem>
}

function mapConfirmationFact(
  fact: ExtensionToolConfirmationFact | ExtensionToolConfirmationInfoFact
): ToolApprovalConfirmation["facts"][number] {
  return {
    label: "label" in fact ? fact.label : fact.name,
    ...(fact.mono === undefined ? {} : { mono: fact.mono }),
    value: fact.value
  }
}

function mapConfirmation(input: {
  fallbackTitle: string
  value: ExtensionToolConfirmation
}): ToolApprovalConfirmation {
  return {
    facts: (input.value.facts ?? input.value.info)?.map(mapConfirmationFact) ?? [],
    message: input.value.title ? input.value.message : undefined,
    title: input.value.title ?? input.value.message ?? input.fallbackTitle,
    tone: input.value.tone ?? "default"
  }
}

export function createDynamicExtensionToolApprovalPolicyProvider(input: {
  getExtensionExecutionContext?: (extensionName: string) => NativeExtensionExecutionContext
  getExtensionPreferences?: (extensionName: string) => Record<string, unknown>
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

  function buildPolicy(binding: ExtensionAgentToolBinding): ExtensionToolApprovalPolicy {
    const mode = input.permissionMode ?? binding.resolvedCapability.permissionMode
    return {
      binding,
      decision: resolveExtensionToolPermission({
        access: binding.definition.access,
        mode
      })
    }
  }

  async function buildReview(
    binding: ExtensionAgentToolBinding,
    args: Record<string, unknown>
  ): Promise<ToolApprovalItem> {
    const mode = input.permissionMode ?? binding.resolvedCapability.permissionMode
    const decision = resolveExtensionToolPermission({
      access: binding.definition.access,
      mode
    })
    const executionContext = input.getExtensionExecutionContext?.(binding.definition.extensionName)
    const extensionPreferences =
      executionContext?.extensionPreferences ??
      input.getExtensionPreferences?.(binding.definition.extensionName) ??
      binding.resolvedCapability.publicConfig
    const toolTitle = binding.display.title
    const confirmation = binding.definition.approval?.confirmation
      ? mapConfirmation({
          fallbackTitle: toolTitle,
          value: await binding.definition.approval.confirmation(args, {
            access: binding.definition.access,
            agentToolName: binding.agentToolName,
            capabilityDisplayName: binding.resolvedCapability.displayName,
            capabilityId: binding.capability.id,
            connection: executionContext?.connection,
            extensionName: binding.definition.extensionName,
            extensionPreferences,
            permissionMode: mode,
            runId: null,
            threadId: "",
            toolName: binding.definition.name,
            toolTitle,
            workspacePath: ""
          })
        })
      : undefined

    return buildExtensionToolApprovalItem(
      {
        access: binding.definition.access,
        capabilityDisplayName: binding.resolvedCapability.displayName,
        capabilityId: binding.capability.id,
        confirmation,
        extensionName: binding.definition.extensionName,
        permissionMode: mode,
        reason: decision.reason,
        toolName: binding.agentToolName,
        toolTitle
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
