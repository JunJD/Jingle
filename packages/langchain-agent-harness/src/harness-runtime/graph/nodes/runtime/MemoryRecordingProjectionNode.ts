import type { JingleContextInclusionStateItem } from "../../../../context-inclusion-state"
import { projectMemoryRecordingRefs } from "../../../../memory-recording-projection"
import type { RuntimeProjectionFailureObserver } from "../../../../runtime-observation"
import type { RuntimeCheckpointState } from "../../../../runtime-state"
import type { RuntimeNodeResult, RuntimeTargetNode } from "./node-contract"

export interface RuntimeMemoryRecordingProjectionInput {
  contextInclusions: JingleContextInclusionStateItem[]
}

export type MemoryRecordingProjectionNodeResult = RuntimeNodeResult<
  Partial<Pick<RuntimeCheckpointState, "recordingRefs">>
>

export class MemoryRecordingProjectionNode implements RuntimeTargetNode<
  RuntimeMemoryRecordingProjectionInput,
  MemoryRecordingProjectionNodeResult
> {
  readonly boundary = "projection"
  readonly kind = "MemoryRecordingProjectionNode"

  constructor(private readonly observeFailure?: RuntimeProjectionFailureObserver) {}

  invoke(input: RuntimeMemoryRecordingProjectionInput): MemoryRecordingProjectionNodeResult {
    try {
      const recordingRefs = projectMemoryRecordingRefs(input)
      return recordingRefs.length > 0 ? { stateUpdate: { recordingRefs } } : {}
    } catch (error) {
      this.#observeFailure(error)
      return {}
    }
  }

  #observeFailure(error: unknown): void {
    try {
      this.observeFailure?.({ error, projection: "memory-recording" })
    } catch {
      // Observation cannot change the projection or core run outcome.
    }
  }
}
