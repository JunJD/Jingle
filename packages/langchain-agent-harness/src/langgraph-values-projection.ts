import {
  extractJingleHitlRequestFromValuesState,
  projectJinglePendingApprovalFromHitlRequest,
  projectJingleValuesInterruptWithRequestIds
} from "./langgraph-hitl-reader"
import type {
  JingleLangGraphSerializedMessageChunk,
  JingleLangGraphValuesState
} from "./langgraph-stream-reader"
import type { RuntimeApproval } from "./runtime-state"

export interface JingleValuesFileProjection {
  is_dir?: boolean
  path: string
  size?: number
}

export interface JingleValuesHostProjection {
  __interrupt__?: unknown[]
  approvals?: unknown[]
  compactions?: unknown[]
  contextInclusions?: unknown[]
  files?: JingleValuesFileProjection[]
  messages?: JingleLangGraphSerializedMessageChunk[]
  recordingRefs?: unknown[]
  todos?: Array<{ content?: string; id?: string; status?: string }>
  toolDecisions?: unknown[]
  workspacePath?: string
}

export interface ProjectJingleStreamChunkForHostIpcInput {
  data: unknown
  mode: string
  runId?: string
  threadId?: string
}

function getJingleValuesFileSize(file: unknown): number | undefined {
  if (!file || typeof file !== "object") {
    return undefined
  }

  if (typeof (file as { size?: unknown }).size === "number") {
    return (file as { size: number }).size
  }

  const content = (file as { content?: unknown }).content
  if (typeof content === "string") {
    return content.length
  }

  if (Array.isArray(content)) {
    return content.reduce((total, line) => total + (typeof line === "string" ? line.length : 0), 0)
  }

  return undefined
}

function projectJingleValuesFiles(files: unknown): JingleValuesFileProjection[] | undefined {
  if (Array.isArray(files)) {
    const projectedFiles = files.flatMap((file) => {
      if (!file || typeof file !== "object") {
        return []
      }

      const path = (file as { path?: unknown }).path
      if (typeof path !== "string" || !path) {
        return []
      }

      const projectedFile = {
        path
      } as JingleValuesFileProjection

      if (typeof (file as { is_dir?: unknown }).is_dir === "boolean") {
        projectedFile.is_dir = (file as { is_dir: boolean }).is_dir
      }

      const size = getJingleValuesFileSize(file)
      if (size !== undefined) {
        projectedFile.size = size
      }

      return [projectedFile]
    })

    return projectedFiles.length > 0 ? projectedFiles : undefined
  }

  if (!files || typeof files !== "object") {
    return undefined
  }

  const projectedFiles = Object.entries(files).map(([path, file]) => {
    const projectedFile = {
      path
    } as JingleValuesFileProjection
    const size = getJingleValuesFileSize(file)

    if (size !== undefined) {
      projectedFile.size = size
    }

    return projectedFile
  })

  return projectedFiles.length > 0 ? projectedFiles : undefined
}

export function projectJingleValuesStateForHost(data: unknown): JingleValuesHostProjection {
  if (!data || typeof data !== "object") {
    return {}
  }

  const state = data as JingleLangGraphValuesState
  const projectedState: JingleValuesHostProjection = {}

  if (Array.isArray(state.messages)) {
    projectedState.messages = state.messages
  }

  if (state.todos !== undefined && !Array.isArray(state.todos)) {
    throw new Error("[JingleLangGraph] Invalid values todos state.")
  }

  if (state.todos) {
    projectedState.todos = state.todos
  }

  if (state.contextInclusions !== undefined && !Array.isArray(state.contextInclusions)) {
    throw new Error("[JingleLangGraph] Invalid values contextInclusions state.")
  }

  if (Array.isArray(state.contextInclusions)) {
    projectedState.contextInclusions = state.contextInclusions
  }

  if (state.compactions !== undefined && !Array.isArray(state.compactions)) {
    throw new Error("[JingleLangGraph] Invalid values compactions state.")
  }

  if (Array.isArray(state.compactions)) {
    projectedState.compactions = state.compactions
  }

  if (state.approvals !== undefined && !Array.isArray(state.approvals)) {
    throw new Error("[JingleLangGraph] Invalid values approvals state.")
  }

  if (Array.isArray(state.approvals)) {
    projectedState.approvals = state.approvals
  }

  if (state.toolDecisions !== undefined && !Array.isArray(state.toolDecisions)) {
    throw new Error("[JingleLangGraph] Invalid values toolDecisions state.")
  }
  if (Array.isArray(state.toolDecisions)) {
    projectedState.toolDecisions = state.toolDecisions
  }

  if (state.recordingRefs !== undefined && !Array.isArray(state.recordingRefs)) {
    throw new Error("[JingleLangGraph] Invalid values recordingRefs state.")
  }

  if (Array.isArray(state.recordingRefs)) {
    projectedState.recordingRefs = state.recordingRefs
  }

  if (typeof state.workspacePath === "string" && state.workspacePath.trim()) {
    projectedState.workspacePath = state.workspacePath
  }

  const projectedFiles = projectJingleValuesFiles(state.files)
  if (projectedFiles) {
    projectedState.files = projectedFiles
  }

  if (Array.isArray(state.__interrupt__)) {
    projectedState.__interrupt__ = state.__interrupt__
  }

  return projectedState
}

function projectJingleValuesStateForHostIpc(
  data: unknown,
  options?: {
    runId?: string
    threadId?: string
  }
): JingleValuesHostProjection {
  const projectedState = projectJingleValuesStateForHost(data)

  if (options?.threadId && options?.runId) {
    const pendingHitlRequest = extractJingleHitlRequestFromValuesState(
      options.threadId,
      options.runId,
      data,
      {
        parseReview: () => null
      }
    )
    if (pendingHitlRequest) {
      const pendingApproval = projectJinglePendingApprovalFromHitlRequest(pendingHitlRequest)
      projectedState.approvals = upsertProjectedApproval(projectedState.approvals, pendingApproval)
    }

    const projectedInterrupt = projectJingleValuesInterruptWithRequestIds(
      options.threadId,
      options.runId,
      data
    )
    if (projectedInterrupt) {
      projectedState.__interrupt__ = projectedInterrupt
    }
  }

  return projectedState
}

function upsertProjectedApproval(
  existing: unknown[] | undefined,
  approval: RuntimeApproval
): RuntimeApproval[] {
  const approvals = Array.isArray(existing) ? [...existing] : []
  const existingIndex = approvals.findIndex((candidate) => {
    return (
      Boolean(candidate) &&
      typeof candidate === "object" &&
      (candidate as { approvalId?: unknown }).approvalId === approval.approvalId
    )
  })
  if (existingIndex >= 0) {
    approvals[existingIndex] = approval
  } else {
    approvals.push(approval)
  }
  return approvals as RuntimeApproval[]
}

export function projectJingleStreamChunkForHostIpc(
  input: ProjectJingleStreamChunkForHostIpcInput
): unknown {
  if (input.mode !== "values") {
    return input.data
  }

  return projectJingleValuesStateForHostIpc(input.data, {
    runId: input.runId,
    threadId: input.threadId
  })
}
