export { closeDatabase, initializeDatabase } from "./lifecycle"
export {
  cloneThreadUntilCheckpoint,
  cloneThread,
  createThread,
  deleteThread,
  getAllThreads,
  getThread,
  searchThreadMatches,
  updateThread,
  updateThreadMetadata
} from "./threads"
export type {
  CloneThreadUntilCheckpointInput,
  ThreadRow,
  ThreadSearchDirectMatchRow,
  ThreadSearchMatches,
  ThreadSearchMessageMatchRow,
  UpdateThreadInput
} from "./threads"
export {
  getProjects,
  getThreadWorkspaceBinding,
  getThreadWorkspaceBindings,
  mapProjectRecord,
  mapThreadWorkspaceBindingRecord,
  upsertProject,
  upsertThreadWorkspaceBinding
} from "./thread-workspace"
export type {
  ProjectRow,
  ThreadWorkspaceBindingRow,
  UpsertProjectInput,
  UpsertThreadWorkspaceBindingInput
} from "./thread-workspace"
export { createRun, getLatestRun, getRun, updateRun } from "./runs"
export type { CreateRunInput, RunRow, UpdateRunInput } from "./runs"
export {
  getHitlRequest,
  getLatestHitlRequest,
  hasPendingHitlRequest,
  hasPendingHitlRequestForRun,
  resolveHitlRequest,
  resolvePendingHitlRequests,
  upsertHitlRequest
} from "./hitl"
export type { HitlRequestRow, UpsertHitlRequestInput } from "./hitl"
export {
  rebuildMessageSearchIndexFromMessages,
  syncMessageProjectionFromSnapshot,
  syncMessageSearchIndexFromSnapshot
} from "./message-search"
export {
  AgentEventRecorder,
  appendAgentEvent,
  appendAgentEventSafely,
  enqueueAgentTraceProjection,
  flushAgentTraceProjection
} from "./agent-events"
export type { AgentEventRow, AppendAgentEventInput } from "./agent-events"
export {
  getAgentTrace,
  getAgentTraceBlob,
  getAgentTraceEvents,
  getAgentTraceStep,
  getAgentTraceSteps,
  listAgentTraces,
  projectAgentTraceForRun
} from "./agent-traces"
export type { AgentTraceBlobRow, AgentTraceStepRow, AgentTraceSummaryRow } from "./agent-traces"
