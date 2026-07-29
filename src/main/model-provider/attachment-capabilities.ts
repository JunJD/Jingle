import type { ModelAttachmentCapabilities } from "./types"
import { projectModelAttachmentCapabilities } from "@shared/model-attachment-capabilities"
import { getProviderAdapter } from "./adapters"
import { getModelAttachmentModalities, getModelConfig, parseProviderModelId } from "./catalog"

export function resolveModelAttachmentCapabilities(
  modelId: string
): ModelAttachmentCapabilities | null {
  const model = getModelConfig(modelId)
  const features = model?.features ?? getModelAttachmentModalities(modelId)
  if (!features) {
    return null
  }
  const providerId = model?.provider ?? parseProviderModelId(modelId).providerId

  return projectModelAttachmentCapabilities({
    features,
    transport: getProviderAdapter(providerId).attachmentTransportCapabilities
  })
}
