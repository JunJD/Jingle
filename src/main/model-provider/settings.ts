import { getDefaultModelId, setDefaultModelId } from "../preferences"

export function getModelProviderDefaultModel(): string {
  return getDefaultModelId()
}

export function setModelProviderDefaultModel(modelId: string): void {
  setDefaultModelId(modelId)
}
