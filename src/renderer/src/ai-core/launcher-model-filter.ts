import type { ModelConfig, Provider } from "@/types"

export function isLauncherHeaderUsableModel(
  model: ModelConfig,
  provider: Provider | undefined
): boolean {
  return (
    model.status === "active" &&
    provider?.customConfiguration.status === "active" &&
    provider.modelListStatus === "active"
  )
}
