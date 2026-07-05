import type { RuntimeExecutionMiddleware } from "./harness-runtime"
import {
  createRunSteeringMiddleware,
  type AgentRunSteeringBufferPort
} from "./run-steering"

export interface CreateRuntimeSteeringEntriesInput {
  steeringBuffer?: AgentRunSteeringBufferPort | null
}

export function createRuntimeSteeringEntries(
  input: CreateRuntimeSteeringEntriesInput
): readonly RuntimeExecutionMiddleware[] {
  return input.steeringBuffer ? [createRunSteeringMiddleware(input.steeringBuffer)] : []
}
