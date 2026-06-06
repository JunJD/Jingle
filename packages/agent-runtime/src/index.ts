export type AgentRuntimeRunSource = "invoke" | "resume"
export type AgentRuntimeRunStatus =
  | "cancelled"
  | "completed"
  | "failed"
  | "running"
  | "waiting_approval"

export interface AgentRuntimeWorkspace {
  canonicalPath: string
  displayName: string
  workspaceKey: string
}

export interface AgentRunContext {
  modelId?: string
  permissionMode: string
  runId: string
  source: AgentRuntimeRunSource
  threadId: string
  workspace: AgentRuntimeWorkspace
  workspacePath: string
}

export interface AgentRuntimeInvokeInput {
  context: AgentRunContext
  message: unknown
}

export interface AgentRuntimeResumeInput {
  context: AgentRunContext
  decision: unknown
  requestId: string
}

export interface AgentRuntimeEventSink {
  publish(batch: unknown): Promise<void> | void
}

export interface AgentRuntimeHostPorts {
  events: AgentRuntimeEventSink
}

export interface AgentRuntimeKernel {
  cancel(input: { threadId: string }): Promise<boolean>
  invoke(input: AgentRuntimeInvokeInput): Promise<void>
  resume(input: AgentRuntimeResumeInput): Promise<void>
}
