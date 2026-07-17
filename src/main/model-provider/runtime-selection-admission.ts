import type { ModelRuntimeSelection } from "@shared/app-types"
import {
  parseModelRuntimeSelection,
  readRunModelRuntimeSelection,
  readThreadModelRuntimeSelection
} from "@shared/model-runtime-selection"
import { JingleIpcError } from "../ipc/error"
import { resolveModelRuntimeConfig } from "./resolver"

export function validateModelRuntimeSelectionForAdmission(input: {
  channel: string
  selection: unknown
}): ModelRuntimeSelection {
  const selection = parseModelRuntimeSelection(input.selection)
  if (!selection) {
    throw failedPrecondition(
      input.channel,
      "The model runtime selection is invalid or uses an unsupported version. Select the model again."
    )
  }

  try {
    resolveModelRuntimeConfig({ selection })
  } catch (error) {
    throw failedPrecondition(input.channel, toVisibleSelectionError(error))
  }
  return selection
}

export function requirePersistedModelRuntimeSelection(input: {
  channel: string
  metadata: Record<string, unknown> | null | undefined
  owner: "run" | "thread"
}): ModelRuntimeSelection {
  return validateModelRuntimeSelectionForAdmission({
    channel: input.channel,
    selection: requirePersistedModelRuntimeSelectionSnapshot(input)
  })
}

export function requirePersistedModelRuntimeSelectionSnapshot(input: {
  channel: string
  metadata: Record<string, unknown> | null | undefined
  owner: "run" | "thread"
}): ModelRuntimeSelection {
  const state =
    input.owner === "thread"
      ? readThreadModelRuntimeSelection(input.metadata)
      : readRunModelRuntimeSelection(input.metadata)
  switch (state.kind) {
    case "ready":
      return state.selection
    case "legacy_missing_effort":
      throw failedPrecondition(
        input.channel,
        input.owner === "thread"
          ? "This thread predates durable reasoning effort. Select the model again before running."
          : "This run predates durable reasoning effort and cannot be resumed safely. Start a new run after selecting the model again."
      )
    case "invalid":
      throw failedPrecondition(
        input.channel,
        `This ${input.owner} has an invalid model runtime selection. Select the model again.`
      )
    case "missing":
      throw failedPrecondition(
        input.channel,
        `This ${input.owner} has no model runtime selection. Select a model before running.`
      )
  }
}

function failedPrecondition(channel: string, message: string): JingleIpcError {
  return new JingleIpcError({ channel, code: "FAILED_PRECONDITION", message })
}

function toVisibleSelectionError(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : "The model runtime selection is not supported. Select the model again."
}
