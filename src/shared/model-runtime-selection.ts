import type {
  ModelRuntimeSelection,
  ThinkingEffort,
  ThreadModelRuntimeSelectionChangedEvent,
  ThreadModelRuntimeSelectionState
} from "./app-types"

export const MODEL_RUNTIME_SELECTION_METADATA_KEY = "modelRuntimeSelection"
export const MODEL_RUNTIME_SELECTION_REVISION_METADATA_KEY = "modelRuntimeSelectionRevision"
export const MODEL_RUNTIME_SELECTION_VERSION = 1 as const

const THINKING_EFFORTS = new Set<ThinkingEffort>([
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max"
])

export function parseModelRuntimeSelection(value: unknown): ModelRuntimeSelection | null {
  if (!isRecord(value)) {
    return null
  }
  let descriptors: PropertyDescriptorMap
  try {
    descriptors = Object.getOwnPropertyDescriptors(value)
  } catch {
    return null
  }
  const keys = Reflect.ownKeys(descriptors)
  if (
    keys.length !== 3 ||
    !keys.includes("modelId") ||
    !keys.includes("thinkingEffort") ||
    !keys.includes("version")
  ) {
    return null
  }
  const modelId = readEnumerableDataProperty(descriptors.modelId)
  const thinkingEffort = readEnumerableDataProperty(descriptors.thinkingEffort)
  const version = readEnumerableDataProperty(descriptors.version)
  if (typeof modelId !== "string" || modelId.length === 0 || modelId !== modelId.trim()) {
    return null
  }
  if (
    version !== MODEL_RUNTIME_SELECTION_VERSION ||
    (thinkingEffort !== null && !isThinkingEffort(thinkingEffort))
  ) {
    return null
  }

  return Object.freeze({ modelId, thinkingEffort, version: MODEL_RUNTIME_SELECTION_VERSION })
}

export function parseThreadModelRuntimeSelectionChangedEvent(
  value: unknown
): ThreadModelRuntimeSelectionChangedEvent | null {
  if (!isRecord(value)) {
    return null
  }
  let descriptors: PropertyDescriptorMap
  try {
    descriptors = Object.getOwnPropertyDescriptors(value)
  } catch {
    return null
  }
  const keys = Reflect.ownKeys(descriptors)
  if (
    keys.length !== 3 ||
    !keys.includes("revision") ||
    !keys.includes("selection") ||
    !keys.includes("threadId")
  ) {
    return null
  }
  const revision = readEnumerableDataProperty(descriptors.revision)
  const selection = parseModelRuntimeSelection(readEnumerableDataProperty(descriptors.selection))
  const threadId = readEnumerableDataProperty(descriptors.threadId)
  if (
    !isModelRuntimeSelectionRevision(revision) ||
    !selection ||
    typeof threadId !== "string" ||
    threadId.length === 0 ||
    threadId !== threadId.trim()
  ) {
    return null
  }

  return Object.freeze({ revision, selection, threadId })
}

export function readThreadModelRuntimeSelection(
  metadata: Record<string, unknown> | null | undefined
): ThreadModelRuntimeSelectionState {
  const hasSelection = Boolean(
    metadata && Object.hasOwn(metadata, MODEL_RUNTIME_SELECTION_METADATA_KEY)
  )
  const hasRevision = Boolean(
    metadata && Object.hasOwn(metadata, MODEL_RUNTIME_SELECTION_REVISION_METADATA_KEY)
  )
  if (hasSelection || hasRevision) {
    const selection = parseModelRuntimeSelection(metadata?.[MODEL_RUNTIME_SELECTION_METADATA_KEY])
    const revision = metadata?.[MODEL_RUNTIME_SELECTION_REVISION_METADATA_KEY]
    return hasSelection && hasRevision && selection && isModelRuntimeSelectionRevision(revision)
      ? { kind: "ready", selection }
      : { kind: "invalid" }
  }

  const legacyModelId = metadata?.model
  if (
    typeof legacyModelId === "string" &&
    legacyModelId.length > 0 &&
    legacyModelId === legacyModelId.trim()
  ) {
    return {
      kind: "legacy_missing_effort",
      modelId: legacyModelId
    }
  }

  return { kind: "missing" }
}

export function readRunModelRuntimeSelection(
  metadata: Record<string, unknown> | null | undefined
): ThreadModelRuntimeSelectionState {
  if (metadata && Object.hasOwn(metadata, MODEL_RUNTIME_SELECTION_METADATA_KEY)) {
    const selection = parseModelRuntimeSelection(metadata[MODEL_RUNTIME_SELECTION_METADATA_KEY])
    return selection ? { kind: "ready", selection } : { kind: "invalid" }
  }

  const legacyModelId = metadata?.modelId
  if (
    typeof legacyModelId === "string" &&
    legacyModelId.length > 0 &&
    legacyModelId === legacyModelId.trim()
  ) {
    return {
      kind: "legacy_missing_effort",
      modelId: legacyModelId
    }
  }

  return { kind: "missing" }
}

export function withModelRuntimeSelection(
  metadata: Record<string, unknown> | null | undefined,
  selection: ModelRuntimeSelection
): Record<string, unknown> {
  const canonicalSelection = parseModelRuntimeSelection(selection)
  if (!canonicalSelection) {
    throw new Error("Cannot persist an invalid model runtime selection.")
  }
  const next = { ...(metadata ?? {}) }
  delete next.model
  delete next.modelId
  next[MODEL_RUNTIME_SELECTION_METADATA_KEY] = canonicalSelection
  return next
}

export function withThreadModelRuntimeSelection(
  metadata: Record<string, unknown> | null | undefined,
  selection: ModelRuntimeSelection
): {
  metadata: Record<string, unknown>
  revision: number
  selection: ModelRuntimeSelection
} {
  const canonicalSelection = parseModelRuntimeSelection(selection)
  if (!canonicalSelection) {
    throw new Error("Cannot persist an invalid thread model runtime selection.")
  }
  const hasSelection = Boolean(
    metadata && Object.hasOwn(metadata, MODEL_RUNTIME_SELECTION_METADATA_KEY)
  )
  const hasRevision = Boolean(
    metadata && Object.hasOwn(metadata, MODEL_RUNTIME_SELECTION_REVISION_METADATA_KEY)
  )
  if (hasSelection !== hasRevision) {
    throw new Error("Thread model runtime selection and revision must be persisted together.")
  }
  const currentRevision = metadata?.[MODEL_RUNTIME_SELECTION_REVISION_METADATA_KEY]
  if (
    metadata &&
    Object.hasOwn(metadata, MODEL_RUNTIME_SELECTION_REVISION_METADATA_KEY) &&
    !isModelRuntimeSelectionRevision(currentRevision)
  ) {
    throw new Error("Thread model runtime selection revision is invalid.")
  }
  const revision = isModelRuntimeSelectionRevision(currentRevision) ? currentRevision + 1 : 1
  if (!isModelRuntimeSelectionRevision(revision)) {
    throw new Error("Thread model runtime selection revision overflow.")
  }
  const next = withModelRuntimeSelection(metadata, canonicalSelection)
  next[MODEL_RUNTIME_SELECTION_REVISION_METADATA_KEY] = revision
  return { metadata: next, revision, selection: canonicalSelection }
}

export function readThreadModelRuntimeSelectionRevision(
  metadata: Record<string, unknown> | null | undefined
): number {
  const revision = metadata?.[MODEL_RUNTIME_SELECTION_REVISION_METADATA_KEY]
  return isModelRuntimeSelectionRevision(revision) ? revision : 0
}

function isThinkingEffort(value: unknown): value is ThinkingEffort {
  return typeof value === "string" && THINKING_EFFORTS.has(value as ThinkingEffort)
}

function isModelRuntimeSelectionRevision(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
}

function readEnumerableDataProperty(descriptor: PropertyDescriptor | undefined): unknown {
  return descriptor && descriptor.enumerable === true && "value" in descriptor
    ? descriptor.value
    : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
