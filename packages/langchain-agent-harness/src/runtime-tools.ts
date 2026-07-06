import type { RuntimeArtifactsUpdate } from "./runtime-state"
import type { RuntimeRunContextScope, RuntimeThreadScope } from "./runtime-scope"

export interface RuntimeArtifactPresentationContext {
  runId: string | null
  toolCallId: string
}

export interface RuntimeArtifactPresentationResult {
  content: string
  update: RuntimeArtifactsUpdate
}

export interface RuntimeArtifactPresentationConfig {
  presentArtifacts: (
    input: unknown,
    context: RuntimeArtifactPresentationContext
  ) => Promise<RuntimeArtifactPresentationResult>
}

export type RuntimeArtifactPresentationProviderContract = (
  thread: RuntimeThreadScope
) => RuntimeArtifactPresentationConfig

export interface RuntimeLoadExtensionToolInput {
  extensionName: string
}

export interface RuntimeCallExtensionToolInput {
  args: Record<string, unknown>
  extensionName: string
  toolName: string
}

export interface RuntimeExtensionToolContext {
  runId: string | null
}

export interface RuntimeCallExtensionToolContext extends RuntimeExtensionToolContext {
  toolCallId: string | null
}

export interface RuntimeExtensionToolContentResult {
  content: unknown
}

export interface RuntimeExtensionToolStateUpdateResult {
  content: string
  stateUpdate: {
    artifacts: RuntimeArtifactsUpdate
  }
}

export type RuntimeExtensionToolResult =
  | RuntimeExtensionToolContentResult
  | RuntimeExtensionToolStateUpdateResult

export interface RuntimeExtensionToolCallUi {
  display?: unknown
  presentation?: unknown
}

export interface RuntimeExtensionToolsConfig {
  buildPromptSections: () => string[]
  callExtension: (
    input: RuntimeCallExtensionToolInput,
    context: RuntimeCallExtensionToolContext
  ) => Promise<RuntimeExtensionToolResult>
  loadExtension: (
    input: RuntimeLoadExtensionToolInput,
    context: RuntimeExtensionToolContext
  ) => Promise<RuntimeExtensionToolContentResult>
  resolveCallExtensionToolUi?: (
    input: RuntimeCallExtensionToolInput
  ) => RuntimeExtensionToolCallUi | null
}

export type RuntimeExtensionToolsProviderContract = (
  run: RuntimeRunContextScope
) => RuntimeExtensionToolsConfig
