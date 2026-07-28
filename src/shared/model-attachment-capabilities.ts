import type {
  ModelAttachmentCapabilities,
  ModelAttachmentModality,
  ModelFeature,
  ModelProviderAttachmentTransportCapabilities
} from "./app-types"

const ATTACHMENT_MODALITIES = new Set<ModelAttachmentModality>([
  "audio",
  "document",
  "video",
  "vision"
])

export function projectModelAttachmentCapabilities(input: {
  features: readonly ModelFeature[] | undefined
  transport: ModelProviderAttachmentTransportCapabilities
}): ModelAttachmentCapabilities | null {
  const supportedModalities = (input.features ?? []).filter(
    (feature): feature is ModelAttachmentModality =>
      ATTACHMENT_MODALITIES.has(feature as ModelAttachmentModality)
  )
  if (supportedModalities.length === 0) {
    return null
  }

  return {
    supportedFileSourceKinds: [...input.transport.supportedFileSourceKinds],
    supportedImageSourceKinds: [...input.transport.supportedImageSourceKinds],
    supportedModalities
  }
}
