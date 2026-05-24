import type { RunnableConfig } from "@langchain/core/runnables"
import type { ResolvedExtensionAiCapability } from "@shared/extension-sources"
import type { PermissionModeName } from "@shared/permission-mode"

export interface AgentRuntimeTraceInput {
  aiCapabilities: ResolvedExtensionAiCapability[]
  modelId?: string
  permissionMode: PermissionModeName
}

export interface AgentRunTraceInput {
  modelId?: string
  permissionMode?: PermissionModeName
  runId: string
  source: "invoke" | "resume"
  threadId: string
}

export type AgentRunTraceConfig = Pick<RunnableConfig, "metadata" | "runName" | "tags">

function compactMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(metadata).filter(([, value]) => {
      if (value === undefined || value === null) {
        return false
      }

      if (Array.isArray(value)) {
        return value.length > 0
      }

      return value !== ""
    })
  )
}

function listCapabilityNames(capabilities: ResolvedExtensionAiCapability[]): string[] {
  return capabilities.map((capability) => capability.extensionName)
}

export function buildAgentRuntimeTraceConfig(input: AgentRuntimeTraceInput): {
  metadata: Record<string, unknown>
  runName: string
} {
  return {
    runName: "openwork.agent",
    metadata: compactMetadata({
      ls_integration: "openwork",
      openwork_model_id: input.modelId,
      openwork_permission_mode: input.permissionMode,
      openwork_extension_capabilities: listCapabilityNames(input.aiCapabilities)
    })
  }
}

export function buildAgentRunTraceMetadata(input: AgentRunTraceInput): Record<string, unknown> {
  return compactMetadata({
    run_id: input.runId,
    thread_id: input.threadId,
    openwork_run_id: input.runId,
    openwork_thread_id: input.threadId,
    openwork_run_source: input.source,
    openwork_model_id: input.modelId,
    openwork_permission_mode: input.permissionMode
  })
}

export function buildAgentRunTraceConfig(input: AgentRunTraceInput): AgentRunTraceConfig {
  return {
    runName: input.source === "resume" ? "openwork.agent.resume" : "openwork.agent.invoke",
    tags: ["openwork", `openwork:${input.source}`],
    metadata: buildAgentRunTraceMetadata(input)
  }
}
