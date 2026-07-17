import type {
  ModelSelectionCatalogProjection,
  ModelSelectionLoadState
} from "@/features/model-selection/model-selection-projection"
import { useModelSelectionController } from "@/features/model-selection/use-model-selection-controller"
import type { ProviderId } from "@/types"

export interface LauncherAiModelPickerController {
  catalog: ModelSelectionCatalogProjection
  loadState: ModelSelectionLoadState
  openProviderSettings: (providerId: ProviderId) => void
  reload: () => Promise<void>
}

export function useLauncherAiModelPickerController(): LauncherAiModelPickerController {
  const { catalog, loadState, openProviderSettings, reload } = useModelSelectionController()
  return { catalog, loadState, openProviderSettings, reload }
}
