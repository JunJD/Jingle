import { useCallback, useMemo } from "react"
import { useModelSetupController } from "@/features/model-provider/model-setup/useModelSetupController"
import type { ProviderId } from "@/types"
import {
  projectModelSelectionCatalog,
  projectModelSelectionLoadState,
  type ModelSelectionCatalogProjection,
  type ModelSelectionLoadState
} from "./model-selection-projection"

export function useModelSelectionController(): {
  catalog: ModelSelectionCatalogProjection
  loadState: ModelSelectionLoadState
  openProviderSettings: (providerId: ProviderId) => void
  reload: () => Promise<void>
} {
  const { error, loading, reload, snapshot } = useModelSetupController()
  const catalog = useMemo(() => projectModelSelectionCatalog(snapshot), [snapshot])
  const loadState = projectModelSelectionLoadState({ error, loading, snapshot })

  const openProviderSettings = useCallback((providerId: ProviderId): void => {
    void window.electron.openSettingsTab("provider", { providerId })
  }, [])

  return {
    catalog,
    loadState,
    openProviderSettings,
    reload
  }
}
