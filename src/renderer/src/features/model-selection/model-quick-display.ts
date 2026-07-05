import type { ModelConfig } from "@/types"

export function getModelQuickDisplayName(
  modelId: string | null,
  model: ModelConfig | null
): string | null {
  if (model) {
    return model.name
  }

  if (!modelId) {
    return null
  }

  const separatorIndex = modelId.indexOf(":")
  return separatorIndex >= 0 ? modelId.slice(separatorIndex + 1) : modelId
}
