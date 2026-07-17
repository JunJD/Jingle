import type { ModelRuntimeSelection } from "@shared/app-types"
import {
  parseModelRuntimeSelection,
  readRunModelRuntimeSelection,
  readThreadModelRuntimeSelection
} from "@shared/model-runtime-selection"
import { JingleIpcError } from "../ipc/error"
import { resolveModelRuntimeConfig } from "./resolver"

export type RunModelRuntimeSelectionResumeAdmission =
  | {
      kind: "persisted"
      selection: ModelRuntimeSelection
    }
  | {
      expectedLegacyModelId: string
      kind: "legacy_upgrade"
      selection: ModelRuntimeSelection
    }

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

export function admitRunModelRuntimeSelectionForResume(input: {
  channel: "agent:resume"
  metadata: Record<string, unknown> | null | undefined
  recoverySelection: unknown
}): RunModelRuntimeSelectionResumeAdmission {
  const state = readRunModelRuntimeSelection(input.metadata)
  switch (state.kind) {
    case "ready":
      if (input.recoverySelection !== undefined) {
        throw failedPrecondition(
          input.channel,
          "This run already has a durable model runtime selection and cannot be changed during resume."
        )
      }
      return {
        kind: "persisted",
        selection: validateModelRuntimeSelectionForAdmission({
          channel: input.channel,
          selection: state.selection
        })
      }
    case "legacy_missing_effort": {
      if (input.recoverySelection === undefined) {
        throw failedPrecondition(
          input.channel,
          "This run predates durable reasoning effort. Choose a supported reasoning effort before approving or correcting the pending action."
        )
      }
      const selection = validateModelRuntimeSelectionForAdmission({
        channel: input.channel,
        selection: input.recoverySelection
      })
      if (selection.modelId !== state.modelId) {
        throw failedPrecondition(
          input.channel,
          `This run must resume with its original model "${state.modelId}".`
        )
      }
      return {
        expectedLegacyModelId: state.modelId,
        kind: "legacy_upgrade",
        selection
      }
    }
    case "invalid":
      throw failedPrecondition(
        input.channel,
        "This run has an invalid model runtime selection and cannot be repaired safely."
      )
    case "missing":
      throw failedPrecondition(
        input.channel,
        "This run has no model identity and cannot be repaired safely."
      )
  }
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
