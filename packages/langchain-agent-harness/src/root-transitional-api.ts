// Transitional subpath exports for existing app integration, tests,
// checkpoint/projection helpers, and legacy middleware surfaces.
//
// New runtime-facing code should import from the package root. This file is
// exposed through @jingle/langchain-agent-harness/transitional so the remaining
// non-runtime-public surface is visible as migration debt instead of mixing it
// into index.ts.
export type {
  JingleAgentStateArtifactManifest,
  JingleAgentStateArtifactsUpdate
} from "./artifact-state"
export {
  createEmptyJingleAgentStateArtifacts,
  jingleAgentArtifactsStateSchema,
  reduceJingleAgentStateArtifacts
} from "./artifact-state"
export type {
  CreateJingleArtifactToolsHookOptions,
  JingleArtifactPresentationContext
} from "./artifact-tools-middleware"
export { createJingleArtifactToolsHook } from "./artifact-tools-middleware"
export type { CreateJingleExtensionAiToolsHookOptions } from "./extension-ai-tools-middleware"
export {
  createJingleExtensionAiToolsHook,
  JINGLE_CALL_EXTENSION_TOOL_NAME
} from "./extension-ai-tools-middleware"
export {
  jingleAgentContextInclusionsValue,
  jingleAgentContextInclusionsStateSchema,
  upsertJingleContextInclusions
} from "./context-inclusion-state"
export type { CreateJingleContextRetrievalToolsMiddlewareOptions } from "./context-retrieval-tools-middleware"
export {
  createJingleContextRetrievalToolsHook,
  jingleSearchHistoryInputSchema
} from "./context-retrieval-tools-middleware"
export type { CreateJingleMemoryHookOptions } from "./memory-middleware"
export { createJingleMemoryHook, createJingleMemoryRecordingRefsHook } from "./memory-middleware"
export { jingleAgentTitleStateSchema, jingleAgentTitleValue } from "./title-state"
export { JingleNodeFilesystemBackend } from "./harness-runtime/node-filesystem-backend"
export type { JingleNodeFilesystemBackendOptions } from "./harness-runtime/node-filesystem-backend"
export type {
  JingleFilesystemEditResult,
  JingleFilesystemExecuteOptions,
  JingleFilesystemExecuteResponse,
  JingleFilesystemFileData,
  JingleFilesystemFileInfo,
  JingleFilesystemGrepMatch,
  JingleFilesystemWriteResult,
  JingleSandboxBackend
} from "./harness-runtime/filesystem"
export type { JingleCheckpointCommittedEvent } from "./checkpoint-after-commit"
export { handleJingleCheckpointAfterCommit } from "./checkpoint-after-commit"
export {
  assertJingleStringChannelVersions,
  assertJingleStringCheckpointVersions,
  copyJingleCheckpointManifest,
  ensureJingleCheckpointChannelVersions,
  hasJinglePregelTaskMessagesRef,
  JINGLE_LANGGRAPH_MESSAGES_CHANNEL,
  JINGLE_LANGGRAPH_PREGEL_TASKS_CHANNEL,
  normalizeJinglePregelTaskMessages,
  restoreJinglePregelTaskMessages
} from "./checkpoint-storage-shape"
export type {
  AgentRunPendingSteer,
  AgentRunSteeringBufferPort,
  AppliedAgentSteer
} from "./run-steering"
export { buildJingleResumeCommand } from "./resume-command"
export { buildJingleInvokeInitialState, buildJingleSubmittedMessages } from "./submitted-messages"
export { abortJingleAgentRun, completeJingleAgentRun, failJingleAgentRun } from "./run-completion"
export { createJingleCheckpointerManager } from "./checkpointer-manager"
export {
  BASE_SYSTEM_PROMPT,
  buildJingleExecuteToolDescription,
  buildJingleFilesystemSystemPrompt,
  buildJingleSystemPrompt
} from "./prompts"
export { createFilesystemToolErrorMiddleware } from "./filesystem-tool-error-middleware"
export type {
  CreateJingleWorkspaceFileContextMiddlewareOptions,
  JingleWorkspaceFileContextRequest
} from "./workspace-file-context-middleware"
export { createJingleWorkspaceFileContextMiddleware } from "./workspace-file-context-middleware"
export type { GuardrailDecision, GuardrailProvider, GuardrailRequest } from "./guardrail-middleware"
export { createGuardrailMiddleware } from "./guardrail-middleware"
export type { HumanApprovalRequester } from "./human-approval-middleware"
export { createJingleHumanApprovalHook } from "./human-approval-middleware"
export type {
  JingleApprovalDecision,
  JingleApprovalDecisionType,
  JingleApprovalInterrupt,
  JingleApprovalRequest,
  JingleApprovalReviewParser,
  JingleApprovalToolCall
} from "./approval-lifecycle"
export {
  buildJingleApprovalRequestFromInterruptValue,
  buildJingleApprovalRequestId,
  buildJinglePendingApprovalFact,
  buildJingleResolvedApprovalFact,
  getDefaultJingleApprovalAllowedDecisions,
  normalizeJingleApprovalAllowedDecisions,
  projectJingleApprovalInterruptWithRequestId,
  projectJinglePendingApprovalRequestFromValues
} from "./approval-lifecycle"
export type { JingleHitlRequest } from "./langgraph-hitl-reader"
export {
  extractJingleHitlRequestFromValuesState,
  persistJingleValuesHitlRequest,
  projectJinglePendingApprovalFromHitlRequest,
  projectJingleValuesInterruptWithRequestIds,
  resolveJingleCheckpointRunStatus
} from "./langgraph-hitl-reader"
export type { JingleLangGraphCheckpointMessage } from "./langgraph-checkpoint-reader"
export {
  findEarliestJingleLangGraphCheckpointContainingMessage,
  readJingleLangGraphCheckpointConfig,
  readJingleLangGraphSerializedMessage
} from "./langgraph-checkpoint-reader"
export type { ProjectJingleLangGraphCheckpointThreadFactsInput } from "./checkpoint-thread-facts"
export { projectJingleLangGraphCheckpointThreadFacts } from "./checkpoint-thread-facts"
export type { ProjectJingleLangGraphCheckpointMessagesInput } from "./checkpoint-message-projection"
export { projectJingleLangGraphCheckpointMessages } from "./checkpoint-message-projection"
export { hasJingleLangChainToolCallSignal } from "./langchain-message-reader"
export { createJingleLangChainTraceCallback } from "./langchain-trace-callback"
export type {
  JingleLangGraphToolCall,
  JingleLangGraphToolCallChunk,
  JingleLangGraphUsageMetadata,
  JingleLangGraphValuesMessage,
  JingleLangGraphValuesState
} from "./langgraph-stream-reader"
export {
  decodeJingleLangGraphMessagesStreamChunk,
  readJingleLangGraphValuesState
} from "./langgraph-stream-reader"
export { selectJingleValuesAssistantForCurrentStream } from "./values-assistant-selector"
export {
  projectJingleStreamChunkForHostIpc,
  projectJingleValuesStateForHost
} from "./langgraph-values-projection"
export { JingleStreamingToolCallAccumulator } from "./streaming-tool-call-accumulator"
export {
  createJingleTodoHook,
  JINGLE_TODO_SYSTEM_PROMPT,
  JINGLE_TODO_TOOL_DESCRIPTION
} from "./jingle-todo-middleware"
export {
  buildJingleTitlePrompt,
  parseJingleGeneratedTitle,
  shouldGenerateJingleTitle
} from "./title-policy"
export type { JingleTitleGenerationModel } from "./title-generator"
export { createJingleTitleGenerator } from "./title-generator"
export { createJingleTitleHook } from "./title-middleware"
export { createJingleAgentTraceRecordingRef } from "./recording-ref-state"
export { createRuntimeCompactionSummarizationController } from "./agent-loop"
export type {
  JingleCompactionController,
  JingleCompactionInput,
  JingleCompactionResult
} from "./compaction-controller"
export { createJingleCompactionController } from "./compaction-controller"
export { JINGLE_CONTEXT_COMPACTION_SUMMARY_PREFIX } from "./harness-runtime/summarization"
export { createJingleDesktopAutomationToolsMiddleware } from "./desktop-automation-tools"
export { createJingleWebToolsMiddleware } from "./web-tools"
export {
  AgentRunSteeringBuffer,
  createAgentRunSteeringBuffer,
  createRunSteeringMiddleware
} from "./run-steering"
export {
  buildRuntimeInvokeConfig,
  buildRuntimeResumeConfig,
  buildJingleCheckpointLookupConfig
} from "./run-config"
export { drainRuntimeRunStream } from "./run-stream"
export { createRuntimeThreadFromControls } from "./runtime-thread-implementation"
export { buildJingleSkillSources } from "./skill-sources"
export {
  createToolCallConsistencyMiddleware,
  removeOrphanedToolMessages
} from "./tool-call-consistency-middleware"
export {
  buildJingleToolResultUpdateCommand,
  getRunIdFromToolRuntime,
  getToolCallIdFromToolRuntime,
  mapJingleAiMessageToolCalls
} from "./tool-runtime"
