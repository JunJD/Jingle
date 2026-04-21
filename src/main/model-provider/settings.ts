import type { SupportedDefaultModelType } from "@shared/app-types"
import { getDefaultModelId, getDefaultModels, setDefaultModelId } from "../preferences"
import type { DefaultModels } from "./types"

export function getModelProviderDefaultModels(): DefaultModels {
  return getDefaultModels()
}

export function getModelProviderDefaultModel(modelType: SupportedDefaultModelType): string {
  return getDefaultModelId(modelType)
}

export function setModelProviderDefaultModel(
  modelType: SupportedDefaultModelType,
  modelId: string
): void {
  setDefaultModelId(modelType, modelId)
}
