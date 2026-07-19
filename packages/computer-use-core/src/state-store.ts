import { randomUUID } from "node:crypto"
import { sameComputerUseWindowIdentity } from "./authorization"
import type {
  ComputerUseElement,
  ComputerUseForcedReanchorReason,
  ComputerUseFoldedFullView,
  ComputerUseIdentityReason,
  ComputerUseModelObservation,
  ComputerUseObservation,
  ComputerUseObservationDiff,
  ComputerUseObservationQueryResult
} from "./contract"

export interface ComputerUseObservationProjectionPolicy {
  diffByteLimit?: number
  diffChangeLimit?: number
  foldedElementLimit?: number
  fullByteLimit?: number
  minimumStableRefCoverage?: number
  queryByteLimit?: number
}

export interface ComputerUseRefMatch {
  confidence: number
  reason: ComputerUseIdentityReason
  stableRefs: readonly string[]
}

export interface ComputerUseRefMatcher {
  match(input: {
    base: ComputerUseObservation
    successor: ComputerUseObservation
  }): ComputerUseRefMatch
}

export interface ComputerUseDiffProjection {
  added: readonly ComputerUseElement[]
  removed: readonly string[]
  updated: readonly ComputerUseElement[]
}

export interface ComputerUseDiffProjector {
  project(input: {
    base: ComputerUseObservation
    stableRefs: readonly string[]
    successor: ComputerUseObservation
  }): ComputerUseDiffProjection
}

export interface ComputerUseStateIdFactory {
  createStateId(): string
}

export interface ComputerUseObservationStoreDependencies {
  diffProjector?: ComputerUseDiffProjector
  idFactory?: ComputerUseStateIdFactory
  refMatcher?: ComputerUseRefMatcher
}

const DEFAULT_DIFF_BYTE_LIMIT = 48 * 1024
const DEFAULT_DIFF_CHANGE_LIMIT = 128
const DEFAULT_FOLDED_ELEMENT_LIMIT = 80
const DEFAULT_FULL_BYTE_LIMIT = 48 * 1024
const DEFAULT_MINIMUM_STABLE_REF_COVERAGE = 0.5
const DEFAULT_QUERY_BYTE_LIMIT = 48 * 1024
const MAXIMUM_DIFF_CHANGE_LIMIT = 256
const MAXIMUM_FOLDED_ELEMENT_LIMIT = 100
const MAXIMUM_MODEL_PROJECTION_BYTE_LIMIT = 64 * 1024
const MINIMUM_MODEL_PROJECTION_BYTE_LIMIT = 4 * 1024
const MODEL_FIELD_JSON_BYTE_LIMIT = 1_024
const MAX_QUERY_LIMIT = 100
const identityReasons = new Set<ComputerUseIdentityReason>([
  "platform_fingerprint",
  "semantic_match",
  "stable_ref_overlap"
])
const defaultIdFactory: ComputerUseStateIdFactory = { createStateId: randomUUID }
const defaultRefMatcher: ComputerUseRefMatcher = {
  match: ({ base, successor }) => {
    const baseRefs = new Set(base.elements.map((element) => element.ref))
    const stableRefs = successor.elements
      .filter((element) => baseRefs.has(element.ref))
      .map((element) => element.ref)
    const smallerStateSize = Math.min(base.elements.length, successor.elements.length)
    return {
      confidence: smallerStateSize === 0 ? 1 : stableRefs.length / smallerStateSize,
      reason: "stable_ref_overlap",
      stableRefs
    }
  }
}
const defaultDiffProjector: ComputerUseDiffProjector = {
  project: ({ base, stableRefs, successor }) => deriveDiff(base, successor, stableRefs)
}

export class ComputerUseStateUnavailableError extends Error {
  constructor(readonly stateId: string) {
    super(`Computer-use state ${stateId} is missing or was evicted.`)
    this.name = "ComputerUseStateUnavailableError"
  }
}

export class ComputerUseObservationStore {
  private readonly issuedStateIds = new Set<string>()
  private readonly records = new Map<string, ComputerUseObservation>()
  private readonly diffByteLimit: number
  private readonly diffChangeLimit: number
  private readonly foldedElementLimit: number
  private readonly fullByteLimit: number
  private readonly diffProjector: ComputerUseDiffProjector
  private readonly idFactory: ComputerUseStateIdFactory
  private readonly minimumStableRefCoverage: number
  private readonly queryByteLimit: number
  private readonly refMatcher: ComputerUseRefMatcher

  constructor(
    private readonly limit = 128,
    policy: ComputerUseObservationProjectionPolicy = {},
    dependencies: ComputerUseObservationStoreDependencies = {}
  ) {
    this.diffByteLimit = boundedPositiveInteger(
      policy.diffByteLimit ?? DEFAULT_DIFF_BYTE_LIMIT,
      "diffByteLimit",
      MAXIMUM_MODEL_PROJECTION_BYTE_LIMIT
    )
    this.diffChangeLimit = boundedPositiveInteger(
      policy.diffChangeLimit ?? DEFAULT_DIFF_CHANGE_LIMIT,
      "diffChangeLimit",
      MAXIMUM_DIFF_CHANGE_LIMIT
    )
    this.foldedElementLimit = boundedPositiveInteger(
      policy.foldedElementLimit ?? DEFAULT_FOLDED_ELEMENT_LIMIT,
      "foldedElementLimit",
      MAXIMUM_FOLDED_ELEMENT_LIMIT
    )
    this.fullByteLimit = modelProjectionByteLimit(
      policy.fullByteLimit ?? DEFAULT_FULL_BYTE_LIMIT,
      "fullByteLimit"
    )
    const coverage = policy.minimumStableRefCoverage ?? DEFAULT_MINIMUM_STABLE_REF_COVERAGE
    if (
      !Number.isFinite(coverage) ||
      coverage < DEFAULT_MINIMUM_STABLE_REF_COVERAGE ||
      coverage > 1
    ) {
      throw new Error(
        `Computer-use minimumStableRefCoverage must be between ${DEFAULT_MINIMUM_STABLE_REF_COVERAGE} and 1.`
      )
    }
    this.minimumStableRefCoverage = coverage
    this.diffProjector = dependencies.diffProjector ?? defaultDiffProjector
    this.idFactory = dependencies.idFactory ?? defaultIdFactory
    this.queryByteLimit = modelProjectionByteLimit(
      policy.queryByteLimit ?? DEFAULT_QUERY_BYTE_LIMIT,
      "queryByteLimit"
    )
    this.refMatcher = dependencies.refMatcher ?? defaultRefMatcher
    positiveInteger(limit, "stateLimit")
  }

  create(input: Omit<ComputerUseObservation, "stateId">): ComputerUseObservation {
    const refs = new Set<string>()
    for (const [offset, element] of input.elements.entries()) {
      if (!element.ref || refs.has(element.ref)) {
        throw new Error("Computer-use observation contains an empty or duplicate semantic ref.")
      }
      if (element.index !== offset) {
        throw new Error("Computer-use observation element indexes must match canonical order.")
      }
      refs.add(element.ref)
    }
    const stateId = normalizePluginToken(this.idFactory.createStateId(), "state id")
    if (this.issuedStateIds.has(stateId)) {
      throw new Error(`Computer-use state id ${stateId} is already owned by another observation.`)
    }
    this.issuedStateIds.add(stateId)
    const observation = deepFreeze({ ...structuredClone(input), stateId })
    this.records.set(observation.stateId, observation)
    while (this.records.size > this.limit) {
      const oldest = this.records.keys().next().value as string | undefined
      if (!oldest) break
      this.records.delete(oldest)
    }
    return observation
  }

  get(stateId: string): ComputerUseObservation | undefined {
    return this.records.get(stateId)
  }

  project(input: {
    baseStateId?: string
    forceFullReason?: ComputerUseForcedReanchorReason
    stateId: string
  }): ComputerUseModelObservation {
    const successor = this.require(input.stateId)
    if (input.forceFullReason) return this.full(successor, input.forceFullReason)
    if (!input.baseStateId) return this.full(successor, "initial")
    if (input.baseStateId === input.stateId) {
      throw new Error("Computer-use diff requires distinct base and successor states.")
    }
    const base = this.records.get(input.baseStateId)
    if (!base) return this.full(successor, "state_evicted")
    if (!sameObservationRoot(base, successor)) {
      return this.full(successor, "root_replacement")
    }

    const match = validateRefMatch(this.refMatcher.match({ base, successor }), base, successor)
    if (Math.min(base.elements.length, successor.elements.length) > 0) {
      if (match.stableRefs.length === 0) return this.full(successor, "root_replacement")
      if (match.confidence < this.minimumStableRefCoverage) {
        return this.full(successor, "low_identity_confidence")
      }
      if (hasUnconfirmedOverlappingRefs(base, successor, match.stableRefs)) {
        return this.full(successor, "low_identity_confidence")
      }
    }
    const changes = validateDiffProjection(
      this.diffProjector.project({ base, stableRefs: match.stableRefs, successor }),
      base,
      successor,
      match.stableRefs
    )
    const diff = createDiff(base, successor, changes, match)
    if (
      diff.added.length + diff.updated.length + diff.removed.length > this.diffChangeLimit ||
      new TextEncoder().encode(JSON.stringify(diff)).byteLength > this.diffByteLimit
    ) {
      return this.full(successor, "diff_over_budget")
    }
    return diff
  }

  expand(input: {
    limit?: number
    offset?: number
    stateId: string
  }): ComputerUseObservationQueryResult {
    const observation = this.require(input.stateId)
    const offset = nonNegativeInteger(input.offset ?? 0, "offset")
    const limit = queryLimit(input.limit)
    const available = observation.elements.slice(offset)
    return queryResult(
      observation,
      available.slice(0, limit),
      available.length,
      this.queryByteLimit
    )
  }

  inspect(input: { refs: readonly string[]; stateId: string }): ComputerUseObservationQueryResult {
    const observation = this.require(input.stateId)
    const byRef = new Map(observation.elements.map((element) => [element.ref, element]))
    const seen = new Set<string>()
    const elements = input.refs.map((ref) => {
      if (!ref || seen.has(ref)) {
        throw new Error("Computer-use inspect refs must be non-empty and unique.")
      }
      seen.add(ref)
      const element = byRef.get(ref)
      if (!element)
        throw new Error(`Computer-use ref ${ref} is not owned by state ${input.stateId}.`)
      return element
    })
    return queryResult(observation, elements, elements.length, this.queryByteLimit)
  }

  search(input: {
    limit?: number
    query: string
    stateId: string
  }): ComputerUseObservationQueryResult {
    const observation = this.require(input.stateId)
    const query = input.query.trim().toLowerCase()
    if (!query) throw new Error("Computer-use search query must not be empty.")
    const limit = queryLimit(input.limit)
    const matches = observation.elements.filter((element) =>
      searchableElementText(element).includes(query)
    )
    return queryResult(observation, matches.slice(0, limit), matches.length, this.queryByteLimit)
  }

  clear(): void {
    this.records.clear()
  }

  private full(
    observation: ComputerUseObservation,
    reason: ComputerUseFoldedFullView["reason"]
  ): ComputerUseFoldedFullView {
    const application = boundedModelApplication(observation.application)
    return fitModelElements(
      observation.elements.slice(0, this.foldedElementLimit),
      observation.elements.length,
      this.fullByteLimit,
      application.truncatedFields,
      (elements, truncation) => ({
        application: application.value,
        capturedAt: observation.capturedAt,
        elements,
        epoch: observation.epoch,
        hasMore: elements.length < observation.elements.length,
        kind: "full" as const,
        reason,
        stateId: observation.stateId,
        totalElements: observation.elements.length,
        truncation
      })
    )
  }

  private require(stateId: string): ComputerUseObservation {
    const observation = this.records.get(stateId)
    if (!observation) throw new ComputerUseStateUnavailableError(stateId)
    return observation
  }
}

function createDiff(
  base: ComputerUseObservation,
  successor: ComputerUseObservation,
  changes: ComputerUseDiffProjection,
  match: ComputerUseRefMatch
): ComputerUseObservationDiff {
  return deepFreeze({
    added: changes.added.map(exactModelElement),
    baseStateId: base.stateId,
    capturedAt: successor.capturedAt,
    identityConfidence: match.confidence,
    identityReason: match.reason,
    kind: "diff",
    removed: [...changes.removed],
    successorEpoch: successor.epoch,
    successorStateId: successor.stateId,
    updated: changes.updated.map(exactModelElement)
  })
}

function deriveDiff(
  base: ComputerUseObservation,
  successor: ComputerUseObservation,
  stableRefs: readonly string[]
): ComputerUseDiffProjection {
  const baseByRef = new Map(base.elements.map((element) => [element.ref, element]))
  const stableRefSet = new Set(stableRefs)
  const added: ComputerUseElement[] = []
  const updated: ComputerUseElement[] = []
  for (const element of successor.elements) {
    const previous = stableRefSet.has(element.ref) ? baseByRef.get(element.ref) : undefined
    if (!previous) added.push(element)
    else if (!sameElement(previous, element)) updated.push(element)
  }
  return {
    added,
    removed: base.elements
      .filter((element) => !stableRefSet.has(element.ref))
      .map((element) => element.ref),
    updated
  }
}

function hasUnconfirmedOverlappingRefs(
  base: ComputerUseObservation,
  successor: ComputerUseObservation,
  stableRefs: readonly string[]
): boolean {
  const baseRefs = new Set(base.elements.map((element) => element.ref))
  const stableRefSet = new Set(stableRefs)
  return successor.elements.some(
    (element) => baseRefs.has(element.ref) && !stableRefSet.has(element.ref)
  )
}

function validateRefMatch(
  input: ComputerUseRefMatch,
  base: ComputerUseObservation,
  successor: ComputerUseObservation
): ComputerUseRefMatch {
  if (!Number.isFinite(input.confidence) || input.confidence < 0 || input.confidence > 1) {
    throw new Error("Computer-use ref matcher returned invalid confidence.")
  }
  if (!identityReasons.has(input.reason)) {
    throw new Error("Computer-use ref matcher returned an unknown identity reason.")
  }
  if (!Array.isArray(input.stableRefs)) {
    throw new Error("Computer-use ref matcher must return stable refs.")
  }
  const baseRefs = new Set(base.elements.map((element) => element.ref))
  const successorRefs = new Set(successor.elements.map((element) => element.ref))
  const stableRefs = input.stableRefs.map((ref) => normalizePluginToken(ref, "stable ref"))
  if (
    new Set(stableRefs).size !== stableRefs.length ||
    stableRefs.some((ref) => !baseRefs.has(ref) || !successorRefs.has(ref))
  ) {
    throw new Error("Computer-use ref matcher returned refs outside the compared states.")
  }
  const smallerStateSize = Math.min(base.elements.length, successor.elements.length)
  const observedCoverage = smallerStateSize === 0 ? 1 : stableRefs.length / smallerStateSize
  return deepFreeze({
    confidence: Math.min(input.confidence, observedCoverage),
    reason: input.reason,
    stableRefs
  })
}

function validateDiffProjection(
  input: ComputerUseDiffProjection,
  base: ComputerUseObservation,
  successor: ComputerUseObservation,
  stableRefs: readonly string[]
): ComputerUseDiffProjection {
  const expected = deriveDiff(base, successor, stableRefs)
  if (
    !sameElements(input.added, expected.added) ||
    !sameStrings(input.removed, expected.removed) ||
    !sameElements(input.updated, expected.updated)
  ) {
    throw new Error("Computer-use diff projector contradicted the complete stored observations.")
  }
  return deepFreeze({
    added: [...expected.added],
    removed: [...expected.removed],
    updated: [...expected.updated]
  })
}

function sameObservationRoot(
  base: ComputerUseObservation,
  successor: ComputerUseObservation
): boolean {
  return (
    base.application.id === successor.application.id &&
    base.resourceKey === successor.resourceKey &&
    sameComputerUseWindowIdentity(base.window, successor.window)
  )
}

function sameElement(left: ComputerUseElement, right: ComputerUseElement): boolean {
  return (
    left.ref === right.ref &&
    left.index === right.index &&
    left.role === right.role &&
    left.description === right.description &&
    left.identifier === right.identifier &&
    left.title === right.title &&
    left.value === right.value &&
    left.actions.length === right.actions.length &&
    left.actions.every((action, index) => action === right.actions[index])
  )
}

function sameElements(
  left: readonly ComputerUseElement[],
  right: readonly ComputerUseElement[]
): boolean {
  return (
    Array.isArray(left) &&
    left.length === right.length &&
    left.every((element, index) => sameElement(element, right[index]!))
  )
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return (
    Array.isArray(left) &&
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  )
}

function searchableElementText(element: ComputerUseElement): string {
  return [
    element.ref,
    element.role,
    element.identifier,
    element.title,
    element.description,
    element.value
  ]
    .filter((value): value is string => typeof value === "string")
    .join("\n")
    .toLowerCase()
}

function queryResult(
  observation: ComputerUseObservation,
  elements: readonly ComputerUseElement[],
  selectedTotalElements: number,
  byteLimit: number
): ComputerUseObservationQueryResult {
  return fitModelElements(
    elements,
    selectedTotalElements,
    byteLimit,
    0,
    (projected, truncation) => ({
      elements: projected,
      hasMore: truncation.omittedElements > 0,
      stateId: observation.stateId,
      totalElements: observation.elements.length,
      truncation
    })
  )
}

function exactModelElement(element: ComputerUseElement): ComputerUseElement {
  const projected: ComputerUseElement = {
    actions: [...element.actions],
    index: element.index,
    ref: element.ref,
    role: element.role
  }
  if (element.description !== undefined) projected.description = element.description
  if (element.identifier !== undefined) projected.identifier = element.identifier
  if (element.title !== undefined) projected.title = element.title
  if (element.value !== undefined) projected.value = element.value
  return projected
}

function boundedModelElement(element: ComputerUseElement): {
  element: ComputerUseElement
  truncatedFields: number
} {
  const projected = exactModelElement(element)
  let truncatedFields = 0
  for (const field of ["role", "description", "identifier", "title", "value"] as const) {
    const value = projected[field]
    if (value === undefined) continue
    const bounded = boundedJsonString(value)
    projected[field] = bounded.value
    if (bounded.truncated) truncatedFields += 1
  }
  return { element: projected, truncatedFields }
}

function boundedModelApplication(application: ComputerUseObservation["application"]): {
  truncatedFields: number
  value: ComputerUseObservation["application"]
} {
  const id = boundedJsonString(application.id)
  const name = boundedJsonString(application.name)
  return {
    truncatedFields: Number(id.truncated) + Number(name.truncated),
    value: { id: id.value, name: name.value }
  }
}

function fitModelElements<T extends object>(
  source: readonly ComputerUseElement[],
  totalElements: number,
  byteLimit: number,
  envelopeTruncatedFields: number,
  build: (
    elements: readonly ComputerUseElement[],
    truncation: { byteLimit: number; omittedElements: number; truncatedFields: number }
  ) => T
): T {
  const elements: ComputerUseElement[] = []
  let truncatedFields = envelopeTruncatedFields
  for (const sourceElement of source) {
    const projected = boundedModelElement(sourceElement)
    const candidateElements = [...elements, projected.element]
    const candidate = build(candidateElements, {
      byteLimit,
      omittedElements: totalElements - candidateElements.length,
      truncatedFields: truncatedFields + projected.truncatedFields
    })
    if (jsonByteLength(candidate) > byteLimit) continue
    elements.push(projected.element)
    truncatedFields += projected.truncatedFields
  }
  const result = build(elements, {
    byteLimit,
    omittedElements: totalElements - elements.length,
    truncatedFields
  })
  if (jsonByteLength(result) > byteLimit) {
    throw new Error("Computer-use model projection envelope exceeds its fixed byte limit.")
  }
  return deepFreeze(result)
}

function boundedJsonString(value: string): { truncated: boolean; value: string } {
  if (jsonByteLength(value) <= MODEL_FIELD_JSON_BYTE_LIMIT) {
    return { truncated: false, value }
  }
  let low = 0
  let high = value.length
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if (jsonByteLength(value.slice(0, middle)) <= MODEL_FIELD_JSON_BYTE_LIMIT) low = middle
    else high = middle - 1
  }
  let end = low
  if (end > 0 && /[\uD800-\uDBFF]/u.test(value[end - 1]!)) end -= 1
  return { truncated: true, value: value.slice(0, end) }
}

function jsonByteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength
}

function positiveInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`Computer-use ${field} must be a positive safe integer.`)
  }
  return value
}

function nonNegativeInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Computer-use ${field} must be a non-negative safe integer.`)
  }
  return value
}

function queryLimit(value = 20): number {
  const limit = positiveInteger(value, "query limit")
  if (limit > MAX_QUERY_LIMIT) {
    throw new Error(`Computer-use query limit must not exceed ${MAX_QUERY_LIMIT}.`)
  }
  return limit
}

function modelProjectionByteLimit(value: number, field: string): number {
  const limit = boundedPositiveInteger(value, field, MAXIMUM_MODEL_PROJECTION_BYTE_LIMIT)
  if (limit < MINIMUM_MODEL_PROJECTION_BYTE_LIMIT) {
    throw new Error(
      `Computer-use ${field} must be at least ${MINIMUM_MODEL_PROJECTION_BYTE_LIMIT} bytes.`
    )
  }
  return limit
}

function boundedPositiveInteger(value: number, field: string, maximum: number): number {
  const result = positiveInteger(value, field)
  if (result > maximum) {
    throw new Error(`Computer-use ${field} must not exceed ${maximum}.`)
  }
  return result
}

function normalizePluginToken(value: string, field: string, maximum = 1_024): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value !== value.trim() ||
    value.length > maximum
  ) {
    throw new Error(`Computer-use ${field} must be a canonical non-empty string.`)
  }
  return value
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value
  for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested)
  return Object.freeze(value)
}
