import type { JingleContextInclusionStateItem } from "./context-inclusion-state"
import type { RuntimeRecordingRef } from "./runtime-state"

type JingleMemoryContextInclusion = JingleContextInclusionStateItem & {
  availability?: unknown
  createdAt?: unknown
  mode?: unknown
  runId?: unknown
  sourceType?: unknown
  target?: {
    memoryId?: unknown
  }
  threadId?: unknown
}

export function projectMemoryRecordingRefs(input: {
  contextInclusions: readonly JingleContextInclusionStateItem[]
}): RuntimeRecordingRef[] {
  const recordingRefs: RuntimeRecordingRef[] = []
  const seenMemoryIds = new Set<string>()

  for (const rawInclusion of input.contextInclusions) {
    const inclusion = rawInclusion as JingleMemoryContextInclusion
    if (
      inclusion.availability !== "available" ||
      inclusion.mode !== "provided" ||
      inclusion.sourceType !== "memory"
    ) {
      continue
    }

    const memoryId = inclusion.target?.memoryId
    if (typeof memoryId !== "string" || memoryId.length === 0 || memoryId.trim() !== memoryId) {
      throw new Error(
        `Memory recording ref requires target.memoryId for context inclusion "${inclusion.id}".`
      )
    }

    if (seenMemoryIds.has(memoryId)) {
      continue
    }
    seenMemoryIds.add(memoryId)

    if (typeof inclusion.createdAt !== "number") {
      throw new Error(
        `Memory recording ref requires createdAt for context inclusion "${inclusion.id}".`
      )
    }
    if (typeof inclusion.runId !== "string" || inclusion.runId.length === 0) {
      throw new Error(
        `Memory recording ref requires runId for context inclusion "${inclusion.id}".`
      )
    }
    if (typeof inclusion.threadId !== "string" || inclusion.threadId.length === 0) {
      throw new Error(
        `Memory recording ref requires threadId for context inclusion "${inclusion.id}".`
      )
    }

    recordingRefs.push({
      createdAt: new Date(inclusion.createdAt).toISOString(),
      domain: "memory",
      path: null,
      refId: memoryId,
      runId: inclusion.runId,
      threadId: inclusion.threadId
    })
  }

  return recordingRefs
}
