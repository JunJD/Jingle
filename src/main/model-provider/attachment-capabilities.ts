import type { ModelAttachmentCapabilities } from "./types"
import { projectModelAttachmentCapabilities } from "@shared/model-attachment-capabilities"
import { getProviderAdapter } from "./adapters"
import { getModelConfig } from "./catalog"

export function resolveModelAttachmentCapabilities(
  modelId: string
): ModelAttachmentCapabilities | null {
  const model = getModelConfig(modelId)
  if (!model) {
    return null
  }

  return projectModelAttachmentCapabilities({
    features: model.features,
    transport: getProviderAdapter(model.provider).attachmentTransportCapabilities
  })
}
