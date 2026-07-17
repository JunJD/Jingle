import { useHistoryShellStore } from "@/lib/history-shell-store"
import type { ModelProviderAttachmentCapabilities } from "@shared/app-types"

export type LauncherAiModelDisplayProjection =
  | { kind: "configured"; label: string; modelId: string }
  | { kind: "unavailable"; modelId: string }
  | { kind: "none" }

export function useLauncherAiModelDisplayProjection(
  modelId: string | null
): LauncherAiModelDisplayProjection {
  const configuredModel = useHistoryShellStore((state) => {
    if (modelId === null) {
      return null
    }

    const model = state.models.find((candidate) => candidate.id === modelId)
    return model === undefined ? null : model
  })

  if (modelId === null) {
    return { kind: "none" }
  }
  if (configuredModel === null) {
    return { kind: "unavailable", modelId }
  }
  return { kind: "configured", label: configuredModel.name, modelId: configuredModel.id }
}

export function useModelProviderAttachmentCapabilities(
  modelId: string | null
): ModelProviderAttachmentCapabilities | null {
  return useHistoryShellStore((state) => {
    if (modelId === null) {
      return null
    }

    const model = state.models.find((candidate) => candidate.id === modelId)
    if (!model) {
      return null
    }
    return (
      state.providers.find((provider) => provider.id === model.provider)?.attachmentCapabilities ??
      null
    )
  })
}
