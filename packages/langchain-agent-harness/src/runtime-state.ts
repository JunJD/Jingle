import type { BaseMessage } from "@langchain/core/messages"
import { ReducedValue, StateSchema, UntrackedValue } from "@langchain/langgraph"
import { z } from "zod/v4"
import {
  jingleAgentArtifactsValue,
  type JingleAgentStateArtifacts,
  type JingleAgentStateArtifactsUpdate
} from "./artifact-state"
import {
  jingleAgentContextInclusionsValue,
  type JingleContextInclusionStateItem
} from "./context-inclusion-state"
import { jingleAgentTitleValue } from "./title-state"
import type { RuntimeStoreBoundaryId } from "./runtime-store"

export type RuntimeArtifacts = JingleAgentStateArtifacts
export type RuntimeArtifactsUpdate = JingleAgentStateArtifactsUpdate

export const RUNTIME_TODO_STATUSES = ["pending", "in_progress", "completed"] as const
export type RuntimeTodoStatus = (typeof RUNTIME_TODO_STATUSES)[number]

export const RUNTIME_TASK_STATUSES = [
  "pending",
  "running",
  "completed",
  "failed",
  "cancelled"
] as const
export type RuntimeTaskStatus = (typeof RUNTIME_TASK_STATUSES)[number]

export const RUNTIME_COMPACTION_STATUSES = ["pending", "completed", "failed"] as const
export type RuntimeCompactionStatus = (typeof RUNTIME_COMPACTION_STATUSES)[number]

export const RUNTIME_APPROVAL_STATUSES = [
  "pending",
  "approved",
  "user_declined",
  "corrected",
  "resolved",
  "expired"
] as const
export type RuntimeApprovalStatus = (typeof RUNTIME_APPROVAL_STATUSES)[number]

export const RUNTIME_RECORDING_DOMAINS = [
  "agent_trace",
  "artifact",
  "build_test",
  "diagnostics",
  "goal",
  "ipc_boundary",
  "memory",
  "projection",
  "quality_event",
  "storage_commit",
  "workspace_mutation"
] as const
export type RuntimeRecordingDomain = (typeof RUNTIME_RECORDING_DOMAINS)[number]

export interface RuntimeTodo {
  content: string
  id?: string
  status: RuntimeTodoStatus
}

export interface RuntimeTask {
  createdAt: string
  parentTaskId: string | null
  runId: string | null
  status: RuntimeTaskStatus
  taskId: string
  title: string
  updatedAt: string
}

export interface RuntimeCompaction {
  compactionId: string
  compactionCount: number
  cutoffIndex: number
  createdAt: string
  historyRef: string | null
  preservedUserMessageCount: number
  reason: string | null
  status: RuntimeCompactionStatus
  summaryPreview: string | null
  trigger: string
  updatedAt: string
  warning: string | null
}

interface RuntimeApprovalBase {
  approvalId: string
  requestId: string | null
  toolCallId: string | null
}

export type RuntimeApproval =
  | (RuntimeApprovalBase & {
      correction: string
      status: "corrected"
    })
  | (RuntimeApprovalBase & {
      correction: null
      status: Exclude<RuntimeApprovalStatus, "corrected">
    })

export interface RuntimeToolDecision {
  decisionId: string
  outcome: "policy_blocked"
  reason: string
  toolCallId: string
  toolName: string
}

export interface RuntimeRecordingRef {
  createdAt: string
  domain: RuntimeRecordingDomain
  path: string | null
  refId: string
  runId: string | null
  threadId: string | null
}

export interface RuntimeState<TContextInclusion = JingleContextInclusionStateItem> {
  approvals: RuntimeApproval[]
  artifacts: RuntimeArtifacts
  compactions: RuntimeCompaction[]
  contextInclusions: TContextInclusion[]
  recordingRefs: RuntimeRecordingRef[]
  tasks: RuntimeTask[]
  title?: string | null
  todos: RuntimeTodo[]
  toolDecisions: RuntimeToolDecision[]
}

export interface RuntimeCapabilityContract {
  failureSemantics: "core" | "projection" | "tool"
  projection: "checkpoint" | "checkpoint-and-stream" | "projection-only"
  stateRole: RuntimeStateFactRole
  stateKey: keyof RuntimeState
  writePolicy: "command-update" | "derived-projection" | "host-port" | "none"
}

export type RuntimeStateFactRole =
  | "canonical"
  | "projection-seed"
  | "audit-ref"
  | "child-work-skeleton"

export type RuntimeStateFactOwner =
  | "RuntimeApproval"
  | "RuntimeArtifact"
  | "RuntimeChildWork"
  | "RuntimeCompaction"
  | "RuntimeContext"
  | "RuntimeObservation"
  | "RuntimeProjection"
  | "RuntimeTodo"
  | "RuntimeToolDecision"

export interface RuntimeStateFactContract {
  bodyStore: RuntimeStoreBoundaryId | "checkpoint-inline" | "none"
  canonicalStore: RuntimeStoreBoundaryId
  owner: RuntimeStateFactOwner
  productStore: RuntimeStoreBoundaryId | "none"
  projectionStore: RuntimeStoreBoundaryId
  role: RuntimeStateFactRole
  stateKey: RuntimeStateKey
}

const runtimeTodoSchema = z
  .object({
    content: z.string(),
    id: z.string().optional(),
    status: z.enum(RUNTIME_TODO_STATUSES)
  })
  .strict()

const runtimeTaskSchema = z
  .object({
    createdAt: z.string(),
    parentTaskId: z.string().nullable(),
    runId: z.string().nullable(),
    status: z.enum(RUNTIME_TASK_STATUSES),
    taskId: z.string(),
    title: z.string(),
    updatedAt: z.string()
  })
  .passthrough()

const runtimeCompactionSchema = z
  .object({
    compactionId: z.string(),
    compactionCount: z.number().int().min(1),
    cutoffIndex: z.number(),
    createdAt: z.string(),
    historyRef: z.string().nullable(),
    preservedUserMessageCount: z.number().int().min(0),
    reason: z.string().nullable(),
    status: z.enum(RUNTIME_COMPACTION_STATUSES),
    summaryPreview: z.string().nullable(),
    trigger: z.string(),
    updatedAt: z.string(),
    warning: z.string().nullable()
  })
  .passthrough()

const runtimeApprovalBaseSchema = z.object({
  approvalId: z.string(),
  requestId: z.string().nullable(),
  toolCallId: z.string().nullable()
})

const runtimeApprovalSchema = z.discriminatedUnion("status", [
  runtimeApprovalBaseSchema
    .extend({
      correction: z.string().trim().min(1),
      status: z.literal("corrected")
    })
    .strict(),
  runtimeApprovalBaseSchema
    .extend({
      correction: z.null(),
      status: z.enum(RUNTIME_APPROVAL_STATUSES.filter((status) => status !== "corrected"))
    })
    .strict()
])

const runtimeToolDecisionSchema = z
  .object({
    decisionId: z.string().trim().min(1),
    outcome: z.literal("policy_blocked"),
    reason: z.string().trim().min(1),
    toolCallId: z.string().trim().min(1),
    toolName: z.string().trim().min(1)
  })
  .strict()

export function parseRuntimeToolDecision(value: unknown): RuntimeToolDecision {
  return runtimeToolDecisionSchema.parse(value)
}

const runtimeRecordingRefSchema = z
  .object({
    createdAt: z.string(),
    domain: z.enum(RUNTIME_RECORDING_DOMAINS),
    path: z.string().nullable(),
    refId: z.string(),
    runId: z.string().nullable(),
    threadId: z.string().nullable()
  })
  .strict()

const runtimeTodosSchema = z.array(runtimeTodoSchema).default(() => [])
const runtimeTodosUpdateSchema = z.array(runtimeTodoSchema).optional()

const runtimeTasksSchema = z.array(runtimeTaskSchema).default(() => [])
const runtimeTasksUpdateSchema = z.array(runtimeTaskSchema).optional()

const runtimeCompactionsSchema = z.array(runtimeCompactionSchema).default(() => [])
const runtimeCompactionsUpdateSchema = z.array(runtimeCompactionSchema).optional()

const runtimeApprovalsSchema = z.array(runtimeApprovalSchema).default(() => [])
const runtimeApprovalsUpdateSchema = z.array(runtimeApprovalSchema).optional()
const runtimeToolDecisionsSchema = z.array(runtimeToolDecisionSchema).default(() => [])
const runtimeToolDecisionsUpdateSchema = z.array(runtimeToolDecisionSchema).optional()

const runtimeRecordingRefsSchema = z.array(runtimeRecordingRefSchema).default(() => [])
const runtimeRecordingRefsUpdateSchema = z.array(runtimeRecordingRefSchema).optional()

function upsertById<TItem>(
  existing: readonly TItem[],
  incoming: readonly TItem[],
  getId: (item: TItem) => string
): TItem[] {
  const next = [...existing]
  for (const item of incoming) {
    const id = getId(item)
    const existingIndex = next.findIndex((candidate) => getId(candidate) === id)
    if (existingIndex >= 0) {
      next[existingIndex] = item
    } else {
      next.push(item)
    }
  }
  return next
}

export const runtimeTodosValue = new ReducedValue(runtimeTodosSchema, {
  inputSchema: runtimeTodosUpdateSchema,
  reducer: (_existing, update) => update ?? []
})

export const runtimeTasksValue = new ReducedValue(runtimeTasksSchema, {
  inputSchema: runtimeTasksUpdateSchema,
  reducer: (existing, update) =>
    update ? upsertById(existing, update, (item) => item.taskId) : existing
})

export const runtimeCompactionsValue = new ReducedValue(runtimeCompactionsSchema, {
  inputSchema: runtimeCompactionsUpdateSchema,
  reducer: (existing, update) =>
    update ? upsertById(existing, update, (item) => item.compactionId) : existing
})

export const runtimeApprovalsValue = new ReducedValue(runtimeApprovalsSchema, {
  inputSchema: runtimeApprovalsUpdateSchema,
  reducer: (existing, update) =>
    update ? upsertById(existing, update, (item) => item.approvalId) : existing
})

export const runtimeToolDecisionsValue = new ReducedValue(runtimeToolDecisionsSchema, {
  inputSchema: runtimeToolDecisionsUpdateSchema,
  reducer: (existing, update) =>
    update ? upsertById(existing, update, (item) => item.decisionId) : existing
})

export const runtimeRecordingRefsValue = new ReducedValue(runtimeRecordingRefsSchema, {
  inputSchema: runtimeRecordingRefsUpdateSchema,
  reducer: (existing, update) =>
    update ? upsertById(existing, update, (item) => item.refId) : existing
})

export const runtimeStateSchema = new StateSchema({
  _runtimeActivatedContext: new UntrackedValue(),
  _runtimeFrame: new UntrackedValue(undefined, { guard: false }),
  _runtimePermissionDecision: new UntrackedValue(undefined, { guard: false }),
  _runtimeStepRoute: new UntrackedValue(undefined, { guard: false }),
  _runtimeWorkingSet: new UntrackedValue(),
  approvals: runtimeApprovalsValue,
  toolDecisions: runtimeToolDecisionsValue,
  artifacts: jingleAgentArtifactsValue,
  compactions: runtimeCompactionsValue,
  contextInclusions: jingleAgentContextInclusionsValue,
  recordingRefs: runtimeRecordingRefsValue,
  tasks: runtimeTasksValue,
  title: jingleAgentTitleValue,
  todos: runtimeTodosValue
})

export type RuntimeSchema = typeof runtimeStateSchema

export const RUNTIME_CAPABILITY_CONTRACTS = {
  approvals: {
    failureSemantics: "core",
    projection: "checkpoint-and-stream",
    stateRole: "canonical",
    stateKey: "approvals",
    writePolicy: "host-port"
  },
  toolDecisions: {
    failureSemantics: "core",
    projection: "checkpoint-and-stream",
    stateRole: "canonical",
    stateKey: "toolDecisions",
    writePolicy: "command-update"
  },
  artifacts: {
    failureSemantics: "tool",
    projection: "checkpoint-and-stream",
    stateRole: "canonical",
    stateKey: "artifacts",
    writePolicy: "command-update"
  },
  compactions: {
    failureSemantics: "core",
    projection: "checkpoint-and-stream",
    stateRole: "canonical",
    stateKey: "compactions",
    writePolicy: "command-update"
  },
  contextInclusions: {
    failureSemantics: "tool",
    projection: "checkpoint-and-stream",
    stateRole: "canonical",
    stateKey: "contextInclusions",
    writePolicy: "command-update"
  },
  memoryRecordingRefs: {
    failureSemantics: "projection",
    projection: "projection-only",
    stateRole: "audit-ref",
    stateKey: "recordingRefs",
    writePolicy: "derived-projection"
  },
  recordingRefs: {
    failureSemantics: "projection",
    projection: "checkpoint-and-stream",
    stateRole: "audit-ref",
    stateKey: "recordingRefs",
    writePolicy: "command-update"
  },
  toolRecordingRefs: {
    failureSemantics: "tool",
    projection: "checkpoint-and-stream",
    stateRole: "audit-ref",
    stateKey: "recordingRefs",
    writePolicy: "command-update"
  },
  tasks: {
    failureSemantics: "core",
    projection: "checkpoint-and-stream",
    stateRole: "child-work-skeleton",
    stateKey: "tasks",
    writePolicy: "command-update"
  },
  title: {
    failureSemantics: "projection",
    projection: "checkpoint-and-stream",
    stateRole: "projection-seed",
    stateKey: "title",
    writePolicy: "command-update"
  },
  todos: {
    failureSemantics: "core",
    projection: "checkpoint-and-stream",
    stateRole: "canonical",
    stateKey: "todos",
    writePolicy: "command-update"
  }
} as const satisfies Record<string, RuntimeCapabilityContract>

export type RuntimeStateKey = keyof RuntimeState

export const RUNTIME_STATE_FACT_CONTRACTS = {
  approvals: {
    bodyStore: "checkpoint-inline",
    canonicalStore: "checkpoint",
    owner: "RuntimeApproval",
    productStore: "productDb",
    projectionStore: "projection",
    role: "canonical",
    stateKey: "approvals"
  },
  artifacts: {
    bodyStore: "checkpoint-inline",
    canonicalStore: "checkpoint",
    owner: "RuntimeArtifact",
    productStore: "productDb",
    projectionStore: "projection",
    role: "canonical",
    stateKey: "artifacts"
  },
  compactions: {
    bodyStore: "checkpoint-inline",
    canonicalStore: "checkpoint",
    owner: "RuntimeCompaction",
    productStore: "productDb",
    projectionStore: "projection",
    role: "canonical",
    stateKey: "compactions"
  },
  contextInclusions: {
    bodyStore: "checkpoint-inline",
    canonicalStore: "checkpoint",
    owner: "RuntimeContext",
    productStore: "none",
    projectionStore: "projection",
    role: "canonical",
    stateKey: "contextInclusions"
  },
  recordingRefs: {
    bodyStore: "productDb",
    canonicalStore: "checkpoint",
    owner: "RuntimeObservation",
    productStore: "productDb",
    projectionStore: "projection",
    role: "audit-ref",
    stateKey: "recordingRefs"
  },
  tasks: {
    bodyStore: "none",
    canonicalStore: "checkpoint",
    owner: "RuntimeChildWork",
    productStore: "productDb",
    projectionStore: "projection",
    role: "child-work-skeleton",
    stateKey: "tasks"
  },
  title: {
    bodyStore: "none",
    canonicalStore: "checkpoint",
    owner: "RuntimeProjection",
    productStore: "productDb",
    projectionStore: "projection",
    role: "projection-seed",
    stateKey: "title"
  },
  todos: {
    bodyStore: "checkpoint-inline",
    canonicalStore: "checkpoint",
    owner: "RuntimeTodo",
    productStore: "none",
    projectionStore: "projection",
    role: "canonical",
    stateKey: "todos"
  },
  toolDecisions: {
    bodyStore: "checkpoint-inline",
    canonicalStore: "checkpoint",
    owner: "RuntimeToolDecision",
    productStore: "none",
    projectionStore: "projection",
    role: "canonical",
    stateKey: "toolDecisions"
  }
} as const satisfies Record<RuntimeStateKey, RuntimeStateFactContract>

export interface RuntimeCheckpointState<
  TContextInclusion = JingleContextInclusionStateItem
> extends RuntimeState<TContextInclusion> {
  messages: BaseMessage[]
}
