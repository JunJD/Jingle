import { useHistoryShellStore } from "@/lib/history-shell-store"

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
