export interface AgentCoreSubscription {
  dispose(): void
  ready: Promise<void>
}

export interface AgentCoreTransport {
  cancel(threadId: string): Promise<void>
  invoke(input: unknown): void
  resume(input: unknown): void
  subscribe(threadId: string, listener: (batch: unknown) => void): AgentCoreSubscription
}

export interface AgentComposerState {
  refs: readonly unknown[]
  text: string
}

export interface AgentCoreRunState {
  isBusy: boolean
  runId: string | null
  status: "error" | "idle" | "preparing" | "running" | "waiting_approval"
}

export interface AgentCoreState {
  canInvoke: boolean
  canResume: boolean
  canRetry: boolean
  canStop: boolean
  composer: AgentComposerState
  error: string | null
  messages: readonly unknown[]
  pendingApproval: unknown | null
  run: AgentCoreRunState
  toolRenderState: readonly unknown[]
}

export interface AgentCoreController {
  clearError(): void
  invoke(input?: AgentComposerState): Promise<boolean>
  resetDraft(value?: string): void
  resume(decision: unknown): Promise<void>
  retry(): Promise<void>
  setDraft(value: string): void
  stop(): Promise<void>
}
