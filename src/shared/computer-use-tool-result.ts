import {
  parseComputerUseSemanticAction,
  parseComputerUseSemanticActions,
  sameComputerUseSemanticAction,
  getComputerUseRetryDisposition,
  type ComputerUseActionKind,
  type ComputerUseElement,
  type ComputerUseFoldedFullView,
  type ComputerUseFullViewReason,
  type ComputerUseModelObservation,
  type ComputerUseObservationQueryResult,
  type ComputerUseRetryDisposition,
  type ComputerUseSemanticAction,
  type ComputerUseTransactionResult
} from "@jingle/computer-use-core"

export const JINGLE_COMPUTER_USE_TOOL_RESULT_VERSION = 1 as const

export type ComputerUseQueryOperation = "expand" | "inspect" | "search"

export type ComputerUseToolResult =
  | {
      kind: "observe"
      observation: ComputerUseFoldedFullView
      sessionId: string
      version: typeof JINGLE_COMPUTER_USE_TOOL_RESULT_VERSION
    }
  | {
      kind: "action"
      projection?: ComputerUseModelObservation
      result: Omit<ComputerUseTransactionResult, "successor">
      retry: ComputerUseRetryDisposition
      version: typeof JINGLE_COMPUTER_USE_TOOL_RESULT_VERSION
    }
  | {
      kind: "query"
      operation: ComputerUseQueryOperation
      result: ComputerUseObservationQueryResult
      version: typeof JINGLE_COMPUTER_USE_TOOL_RESULT_VERSION
    }

const OUTCOMES = new Set([
  "cancelled_before_dispatch",
  "didnt",
  "refused",
  "unavailable",
  "unknown",
  "worked"
])
const FULL_REASONS = new Set([
  "context_compaction",
  "diff_over_budget",
  "external_mutation_uncertain",
  "initial",
  "low_identity_confidence",
  "process_restart",
  "requested",
  "root_replacement",
  "source_truncated",
  "state_evicted"
])
const IDENTITY_REASONS = new Set(["platform_fingerprint", "semantic_match", "stable_ref_overlap"])
const ACTION_KINDS = new Set(["activate", "keypress", "press", "scroll", "set_value", "type_text"])

export function parseComputerUseToolResult(input: {
  args: Record<string, unknown>
  result: unknown
  toolName: string
}): ComputerUseToolResult {
  const value = exactRecord(input.result, "result")
  if (value.version !== JINGLE_COMPUTER_USE_TOOL_RESULT_VERSION) {
    throw new Error("Computer-use result has an unsupported version.")
  }
  if (input.toolName === "computer_use_observe") {
    exactKeys(value, ["kind", "observation", "sessionId", "version"], "result")
    if (value.kind !== "observe") throw new Error("Computer-use observe result kind is invalid.")
    const observation = parseModelObservation(value.observation, "result.observation")
    if (observation.kind !== "full") {
      throw new Error("Computer-use initial observation must be a folded full view.")
    }
    return {
      kind: "observe",
      observation,
      sessionId: canonicalString(value.sessionId, "result.sessionId"),
      version: 1
    }
  }
  if (input.toolName === "computer_use_action") {
    exactKeys(value, ["kind", "projection", "result", "retry", "version"], "result", ["projection"])
    if (value.kind !== "action") throw new Error("Computer-use action result kind is invalid.")
    const baseStateId = canonicalString(input.args.stateId, "args.stateId")
    const actions = parseComputerUseSemanticActions(input.args.actions, "args.actions")
    const transaction = parseTransactionResult(value.result, "result.result")
    if (transaction.baseStateId !== baseStateId) {
      throw new Error("Computer-use action result belongs to another base state.")
    }
    validateTransactionResult(transaction, actions)
    const projection =
      value.projection === undefined
        ? undefined
        : parseModelObservation(value.projection, "result.projection")
    if (projection?.kind === "diff" && projection.baseStateId !== baseStateId) {
      throw new Error("Computer-use action projection belongs to another base state.")
    }
    const retry = parseRetry(value.retry)
    const expectedRetry = getComputerUseRetryDisposition(transaction, actions)
    if (retry.allowed !== expectedRetry.allowed || retry.reason !== expectedRetry.reason) {
      throw new Error("Computer-use retry disposition does not match the transaction result.")
    }
    return {
      kind: "action",
      ...(projection ? { projection } : {}),
      result: transaction,
      retry,
      version: 1
    }
  }
  const operation = queryOperationForTool(input.toolName)
  exactKeys(value, ["kind", "operation", "result", "version"], "result")
  if (value.kind !== "query" || value.operation !== operation) {
    throw new Error("Computer-use query result kind is invalid.")
  }
  const query = parseQueryResult(value.result, "result.result")
  if (query.stateId !== canonicalString(input.args.stateId, "args.stateId")) {
    throw new Error("Computer-use query result belongs to another state.")
  }
  return { kind: "query", operation, result: query, version: 1 }
}

function queryOperationForTool(toolName: string): ComputerUseQueryOperation {
  if (toolName === "computer_use_expand") return "expand"
  if (toolName === "computer_use_inspect") return "inspect"
  if (toolName === "computer_use_search") return "search"
  throw new Error(`Unsupported Computer Use tool result ${toolName}.`)
}

function parseModelObservation(value: unknown, path: string): ComputerUseModelObservation {
  const record = exactRecord(value, path)
  if (record.kind === "full") {
    exactKeys(
      record,
      [
        "application",
        "capturedAt",
        "elements",
        "epoch",
        "hasMore",
        "kind",
        "reason",
        "sourceTruncated",
        "stateId",
        "totalElements",
        "truncation"
      ],
      path
    )
    const application = exactRecord(record.application, `${path}.application`)
    exactKeys(application, ["id", "name"], `${path}.application`)
    const result = {
      application: {
        id: boundedString(application.id, `${path}.application.id`),
        name: boundedString(application.name, `${path}.application.name`)
      },
      capturedAt: finiteNumber(record.capturedAt, `${path}.capturedAt`),
      elements: parseElements(record.elements, `${path}.elements`),
      epoch: nonNegativeInteger(record.epoch, `${path}.epoch`),
      hasMore: booleanValue(record.hasMore, `${path}.hasMore`),
      kind: "full" as const,
      reason: member(record.reason, FULL_REASONS, `${path}.reason`) as ComputerUseFullViewReason,
      sourceTruncated: booleanValue(record.sourceTruncated, `${path}.sourceTruncated`),
      stateId: canonicalString(record.stateId, `${path}.stateId`),
      totalElements: nonNegativeInteger(record.totalElements, `${path}.totalElements`),
      truncation: parseTruncation(record.truncation, `${path}.truncation`)
    }
    return result as ComputerUseModelObservation
  }
  if (record.kind === "diff") {
    exactKeys(
      record,
      [
        "added",
        "baseStateId",
        "capturedAt",
        "identityConfidence",
        "identityReason",
        "kind",
        "removed",
        "successorEpoch",
        "successorStateId",
        "updated"
      ],
      path
    )
    const confidence = finiteNumber(record.identityConfidence, `${path}.identityConfidence`)
    if (confidence < 0 || confidence > 1) throw new Error(`${path}.identityConfidence is invalid.`)
    return {
      added: parseElements(record.added, `${path}.added`),
      baseStateId: canonicalString(record.baseStateId, `${path}.baseStateId`),
      capturedAt: finiteNumber(record.capturedAt, `${path}.capturedAt`),
      identityConfidence: confidence,
      identityReason: member(record.identityReason, IDENTITY_REASONS, `${path}.identityReason`) as
        | "platform_fingerprint"
        | "semantic_match"
        | "stable_ref_overlap",
      kind: "diff",
      removed: stringArray(record.removed, `${path}.removed`),
      successorEpoch: nonNegativeInteger(record.successorEpoch, `${path}.successorEpoch`),
      successorStateId: canonicalString(record.successorStateId, `${path}.successorStateId`),
      updated: parseElements(record.updated, `${path}.updated`)
    }
  }
  throw new Error(`${path}.kind is invalid.`)
}

function parseQueryResult(value: unknown, path: string): ComputerUseObservationQueryResult {
  const record = exactRecord(value, path)
  exactKeys(
    record,
    ["elements", "hasMore", "sourceTruncated", "stateId", "totalElements", "truncation"],
    path
  )
  return {
    elements: parseElements(record.elements, `${path}.elements`),
    hasMore: booleanValue(record.hasMore, `${path}.hasMore`),
    sourceTruncated: booleanValue(record.sourceTruncated, `${path}.sourceTruncated`),
    stateId: canonicalString(record.stateId, `${path}.stateId`),
    totalElements: nonNegativeInteger(record.totalElements, `${path}.totalElements`),
    truncation: parseTruncation(record.truncation, `${path}.truncation`)
  }
}

function parseTransactionResult(
  value: unknown,
  path: string
): Omit<ComputerUseTransactionResult, "successor"> {
  const record = exactRecord(value, path)
  exactKeys(record, ["baseStateId", "outcome", "steps", "stoppedAt"], path, ["stoppedAt"])
  if (!Array.isArray(record.steps)) throw new Error(`${path}.steps must be an array.`)
  return {
    baseStateId: canonicalString(record.baseStateId, `${path}.baseStateId`),
    outcome: member(
      record.outcome,
      OUTCOMES,
      `${path}.outcome`
    ) as ComputerUseTransactionResult["outcome"],
    steps: record.steps.map((step, index) => {
      const entry = exactRecord(step, `${path}.steps[${index}]`)
      exactKeys(entry, ["action", "evidence", "outcome"], `${path}.steps[${index}]`)
      const evidence = exactRecord(entry.evidence, `${path}.steps[${index}].evidence`)
      exactKeys(
        evidence,
        ["delivery", "noSideEffectProof", "route", "verification"],
        `${path}.steps[${index}].evidence`
      )
      return {
        action: parseComputerUseSemanticAction(entry.action, `${path}.steps[${index}].action`),
        evidence: {
          delivery: member(
            evidence.delivery,
            new Set(["semantic", "targeted_input", "global_input"]),
            `${path}.steps[${index}].evidence.delivery`
          ) as "semantic" | "targeted_input" | "global_input",
          noSideEffectProof: booleanValue(
            evidence.noSideEffectProof,
            `${path}.steps[${index}].evidence.noSideEffectProof`
          ),
          route: boundedString(evidence.route, `${path}.steps[${index}].evidence.route`),
          verification: member(
            evidence.verification,
            new Set(["verified", "failed", "unverifiable"]),
            `${path}.steps[${index}].evidence.verification`
          ) as "verified" | "failed" | "unverifiable"
        },
        outcome: member(
          entry.outcome,
          OUTCOMES,
          `${path}.steps[${index}].outcome`
        ) as ComputerUseTransactionResult["outcome"]
      }
    }),
    ...(record.stoppedAt === undefined
      ? {}
      : { stoppedAt: nonNegativeInteger(record.stoppedAt, `${path}.stoppedAt`) })
  }
}

function parseRetry(value: unknown): ComputerUseRetryDisposition {
  const record = exactRecord(value, "result.retry")
  exactKeys(record, ["allowed", "reason"], "result.retry")
  if (record.allowed === true && record.reason === "proven_no_side_effect")
    return { allowed: true, reason: record.reason }
  if (
    record.allowed === false &&
    (record.reason === "cancelled" ||
      record.reason === "not_actionable" ||
      record.reason === "side_effect_possible")
  )
    return { allowed: false, reason: record.reason }
  throw new Error("Computer-use retry disposition is invalid.")
}

function validateTransactionResult(
  result: Omit<ComputerUseTransactionResult, "successor">,
  actions: readonly ComputerUseSemanticAction[]
): void {
  if (
    result.steps.length > actions.length ||
    result.steps.some(
      (step, index) =>
        !actions[index] || !sameComputerUseSemanticAction(step.action, actions[index])
    )
  ) {
    throw new Error("Computer-use action result steps do not match the requested actions.")
  }
  for (const step of result.steps) {
    const evidenceIsConsistent =
      (step.outcome === "worked" &&
        step.evidence.verification === "verified" &&
        !step.evidence.noSideEffectProof) ||
      (step.outcome === "unknown" &&
        step.evidence.verification === "unverifiable" &&
        !step.evidence.noSideEffectProof) ||
      ((step.outcome === "didnt" || step.outcome === "refused" || step.outcome === "unavailable") &&
        step.evidence.verification === "failed" &&
        step.evidence.noSideEffectProof)
    if (!evidenceIsConsistent) {
      throw new Error("Computer-use action result contains contradictory evidence.")
    }
  }
  const outcomes = new Set(result.steps.map((step) => step.outcome))
  if (result.outcome === "cancelled_before_dispatch") {
    if (result.steps.length !== 0 || result.stoppedAt !== undefined) {
      throw new Error("Computer-use cancellation contains dispatched steps.")
    }
    return
  }
  if (result.outcome === "worked") {
    if (
      result.stoppedAt !== undefined ||
      result.steps.length !== actions.length ||
      outcomes.size !== 1 ||
      !outcomes.has("worked")
    ) {
      throw new Error("Computer-use worked result is inconsistent.")
    }
    return
  }
  if (result.outcome === "didnt") {
    if (result.steps.length !== actions.length || outcomes.size !== 1 || !outcomes.has("didnt")) {
      throw new Error("Computer-use didnt result is inconsistent.")
    }
    return
  }
  if (result.outcome === "unknown") {
    if (result.steps.length === 0 || result.stoppedAt !== result.steps.length - 1) {
      throw new Error("Computer-use unknown result has no stopped step prefix.")
    }
    return
  }
  if (result.steps.length === 0) {
    if (result.stoppedAt !== undefined) {
      throw new Error("Computer-use refusal has an invalid stopped step boundary.")
    }
    return
  }
  if (
    result.stoppedAt !== result.steps.length - 1 ||
    result.steps.at(-1)?.outcome !== result.outcome ||
    result.steps
      .slice(0, -1)
      .some((step) => step.outcome === "worked" || step.outcome === "unknown")
  ) {
    throw new Error("Computer-use refusal has an inconsistent stopped step prefix.")
  }
}

function parseElements(value: unknown, path: string): ComputerUseElement[] {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array.`)
  return value.map((element, index) => {
    const record = exactRecord(element, `${path}[${index}]`)
    exactKeys(
      record,
      ["actions", "description", "identifier", "index", "ref", "role", "title", "value"],
      `${path}[${index}]`,
      ["description", "identifier", "title", "value"]
    )
    return {
      actions: stringArray(record.actions, `${path}[${index}].actions`).map(
        (action) =>
          member(action, ACTION_KINDS, `${path}[${index}].actions`) as ComputerUseActionKind
      ),
      index: nonNegativeInteger(record.index, `${path}[${index}].index`),
      ref: canonicalString(record.ref, `${path}[${index}].ref`),
      role: boundedString(record.role, `${path}[${index}].role`),
      ...(record.description === undefined
        ? {}
        : { description: boundedString(record.description, `${path}[${index}].description`) }),
      ...(record.identifier === undefined
        ? {}
        : { identifier: boundedString(record.identifier, `${path}[${index}].identifier`) }),
      ...(record.title === undefined
        ? {}
        : { title: boundedString(record.title, `${path}[${index}].title`) }),
      ...(record.value === undefined
        ? {}
        : { value: boundedString(record.value, `${path}[${index}].value`) })
    }
  })
}

function parseTruncation(value: unknown, path: string) {
  const record = exactRecord(value, path)
  exactKeys(record, ["byteLimit", "omittedElements", "truncatedFields"], path)
  return {
    byteLimit: nonNegativeInteger(record.byteLimit, `${path}.byteLimit`),
    omittedElements: nonNegativeInteger(record.omittedElements, `${path}.omittedElements`),
    truncatedFields: nonNegativeInteger(record.truncatedFields, `${path}.truncatedFields`)
  }
}

function exactRecord(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${path} must be an object.`)
  return value as Record<string, unknown>
}

function exactKeys(
  record: Record<string, unknown>,
  keys: readonly string[],
  path: string,
  optionalKeys: readonly string[] = []
): void {
  const allowed = new Set(keys)
  if (Object.keys(record).some((key) => !allowed.has(key)))
    throw new Error(`${path} contains an unknown field.`)
  const optional = new Set(optionalKeys)
  const required = keys.filter((key) => !optional.has(key))
  if (required.some((key) => !Object.hasOwn(record, key)))
    throw new Error(`${path} is missing a required field.`)
}

function canonicalString(value: unknown, path: string): string {
  const result = boundedString(value, path)
  if (!result || result.trim() !== result) throw new Error(`${path} must be canonical.`)
  return result
}

function boundedString(value: unknown, path: string): string {
  if (typeof value !== "string" || new TextEncoder().encode(value).byteLength > 16 * 1024)
    throw new Error(`${path} must be a bounded string.`)
  return value
}

function stringArray(value: unknown, path: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array.`)
  return value.map((entry, index) => boundedString(entry, `${path}[${index}]`))
}

function booleanValue(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${path} must be boolean.`)
  return value
}

function finiteNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value))
    throw new Error(`${path} must be finite.`)
  return value
}

function nonNegativeInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0)
    throw new Error(`${path} must be a non-negative integer.`)
  return value as number
}

function member(value: unknown, allowed: ReadonlySet<unknown>, path: string): unknown {
  if (!allowed.has(value)) throw new Error(`${path} is invalid.`)
  return value
}
