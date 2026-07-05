import type { CheckpointTuple } from "@langchain/langgraph-checkpoint"
import {
  readJingleLangGraphCheckpointApprovals,
  readJingleLangGraphCheckpointCompactions,
  readJingleLangGraphCheckpointContextInclusions,
  readJingleLangGraphCheckpointRecordingRefs,
  readJingleLangGraphCheckpointTasks,
  readJingleLangGraphCheckpointTitle,
  readJingleLangGraphCheckpointTodos,
  type JingleLangGraphCheckpointTodo
} from "./langgraph-checkpoint-reader"
import type {
  RuntimeApproval,
  RuntimeCompaction,
  RuntimeRecordingRef,
  RuntimeTask
} from "./runtime-state"
import {
  checkpointHasJingleHitlInterrupt,
  extractJingleHitlRequestFromCheckpoint,
  type JingleHitlRequest,
  type JingleHitlReviewParser
} from "./langgraph-hitl-reader"

export interface JingleLangGraphCheckpointProjectedTodo {
  content: string
  id: string
  status: string
}

export interface JingleLangGraphCheckpointThreadFacts<
  TContextInclusion = unknown,
  TReview = unknown
> {
  approvals: RuntimeApproval[]
  compactions: RuntimeCompaction[]
  contextInclusions: TContextInclusion[]
  hasInterrupt: boolean
  hitlRequest: JingleHitlRequest<TReview> | null
  recordingRefs: RuntimeRecordingRef[]
  tasks: RuntimeTask[]
  title: string | null
  todos: JingleLangGraphCheckpointProjectedTodo[]
}

export interface ProjectJingleLangGraphCheckpointThreadFactsInput<TReview = unknown> {
  parseReview?: JingleHitlReviewParser<TReview>
  runId?: string | null
  threadId?: string
  tuple: CheckpointTuple | undefined
}

function projectJingleLangGraphCheckpointApprovals(
  tuple: CheckpointTuple | undefined
): RuntimeApproval[] {
  const approvals = readJingleLangGraphCheckpointApprovals(tuple)
  if (approvals === undefined) {
    return []
  }

  if (!Array.isArray(approvals)) {
    throw new Error("[LangGraphCheckpointReader] Invalid checkpoint approvals channel.")
  }

  return approvals as RuntimeApproval[]
}

function projectJingleLangGraphCheckpointCompactions(
  tuple: CheckpointTuple | undefined
): RuntimeCompaction[] {
  const compactions = readJingleLangGraphCheckpointCompactions(tuple)
  if (compactions === undefined) {
    return []
  }

  if (!Array.isArray(compactions)) {
    throw new Error("[LangGraphCheckpointReader] Invalid checkpoint compactions channel.")
  }

  return compactions as RuntimeCompaction[]
}

function projectJingleLangGraphCheckpointContextInclusions<TContextInclusion = unknown>(
  tuple: CheckpointTuple | undefined
): TContextInclusion[] {
  const contextInclusions = readJingleLangGraphCheckpointContextInclusions(tuple)
  if (contextInclusions === undefined) {
    return []
  }

  if (!Array.isArray(contextInclusions)) {
    throw new Error("[LangGraphCheckpointReader] Invalid checkpoint contextInclusions channel.")
  }

  return contextInclusions as TContextInclusion[]
}

function projectJingleLangGraphCheckpointRecordingRefs(
  tuple: CheckpointTuple | undefined
): RuntimeRecordingRef[] {
  const recordingRefs = readJingleLangGraphCheckpointRecordingRefs(tuple)
  if (recordingRefs === undefined) {
    return []
  }

  if (!Array.isArray(recordingRefs)) {
    throw new Error("[LangGraphCheckpointReader] Invalid checkpoint recordingRefs channel.")
  }

  return recordingRefs as RuntimeRecordingRef[]
}

function projectJingleLangGraphCheckpointTasks(
  tuple: CheckpointTuple | undefined
): RuntimeTask[] {
  const tasks = readJingleLangGraphCheckpointTasks(tuple)
  if (tasks === undefined) {
    return []
  }

  if (!Array.isArray(tasks)) {
    throw new Error("[LangGraphCheckpointReader] Invalid checkpoint tasks channel.")
  }

  return tasks as RuntimeTask[]
}

function projectJingleLangGraphCheckpointTodos(
  tuple: CheckpointTuple | undefined
): JingleLangGraphCheckpointProjectedTodo[] {
  const todos = readJingleLangGraphCheckpointTodos(tuple)
  if (!todos) {
    return []
  }

  return todos.map((todo: JingleLangGraphCheckpointTodo, index: number) => ({
    id: todo.id || `todo-${index}`,
    content: todo.content || "",
    status: todo.status || "pending"
  }))
}

function projectJingleLangGraphCheckpointTitle(tuple: CheckpointTuple | undefined): string | null {
  const title = readJingleLangGraphCheckpointTitle(tuple)
  return typeof title === "string" && title.trim().length > 0 ? title.trim() : null
}

export function projectJingleLangGraphCheckpointThreadFacts<
  TContextInclusion = unknown,
  TReview = unknown
>(
  input: ProjectJingleLangGraphCheckpointThreadFactsInput<TReview>
): JingleLangGraphCheckpointThreadFacts<TContextInclusion, TReview> {
  const hitlRequest =
    input.threadId && input.parseReview
      ? extractJingleHitlRequestFromCheckpoint(input.threadId, input.tuple, {
          parseReview: input.parseReview,
          runId: input.runId
        })
      : null

  return {
    approvals: projectJingleLangGraphCheckpointApprovals(input.tuple),
    compactions: projectJingleLangGraphCheckpointCompactions(input.tuple),
    contextInclusions: projectJingleLangGraphCheckpointContextInclusions<TContextInclusion>(
      input.tuple
    ),
    hasInterrupt: checkpointHasJingleHitlInterrupt(input.tuple),
    hitlRequest,
    recordingRefs: projectJingleLangGraphCheckpointRecordingRefs(input.tuple),
    tasks: projectJingleLangGraphCheckpointTasks(input.tuple),
    title: projectJingleLangGraphCheckpointTitle(input.tuple),
    todos: projectJingleLangGraphCheckpointTodos(input.tuple)
  }
}
