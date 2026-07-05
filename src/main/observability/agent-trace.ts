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
    runName: "jingle.agent",
    metadata: compactMetadata({
      ls_integration: "jingle",
      jingle_model_id: input.modelId,
      jingle_permission_mode: input.permissionMode,
      jingle_extension_capabilities: listCapabilityNames(input.aiCapabilities)
    })
  }
}

export function buildAgentRunTraceMetadata(input: AgentRunTraceInput): Record<string, unknown> {
  return compactMetadata({
    run_id: input.runId,
    thread_id: input.threadId,
    jingle_run_id: input.runId,
    jingle_thread_id: input.threadId,
    jingle_run_source: input.source,
    jingle_model_id: input.modelId,
    jingle_permission_mode: input.permissionMode
  })
}

export function buildAgentRunTraceConfig(input: AgentRunTraceInput): AgentRunTraceConfig {
  return {
    runName: input.source === "resume" ? "jingle.agent.resume" : "jingle.agent.invoke",
    tags: ["jingle", `jingle:${input.source}`],
    metadata: buildAgentRunTraceMetadata(input)
  }
}
