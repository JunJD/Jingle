import type { ModelConfig } from "./types"

export const DEFAULT_MODEL_CONTEXT_LIMIT = 128_000
export const DEFAULT_MODEL_MAX_OUTPUT_TOKENS = 4_096

export function resolveModelContextLimit(model: ModelConfig | undefined): number {
  return model?.contextLimit ?? DEFAULT_MODEL_CONTEXT_LIMIT
}

export function resolveModelMaxOutputTokens(model: ModelConfig | undefined): number | undefined {
  return model?.maxOutputTokens
}

export function resolveRequiredMaxOutputTokens(maxOutputTokens: number | undefined): number {
  return maxOutputTokens ?? DEFAULT_MODEL_MAX_OUTPUT_TOKENS
}
