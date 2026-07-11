import { useCallback, useEffect, useMemo, useState } from "react"
import type { CustomProviderConfig, CustomProviderInput, ProviderId } from "@shared/app-types"
import type {
  ModelSetupModelSelection,
  ModelSetupProviderModelsResult,
  ModelSetupSnapshot,
  ModelSetupUnlistedModelMetadata
} from "@shared/model-setup"

export interface ModelSetupCommands {
  activateProvider: (providerId: ProviderId) => Promise<ModelSetupCommandResult>
  deleteCredentials: (providerId: ProviderId) => Promise<ModelSetupCommandResult>
  getCredentials: (providerId: ProviderId) => Promise<Record<string, string> | null>
  getCustomProvider: (providerId: ProviderId) => Promise<CustomProviderConfig | null>
  refreshProviderModels: (providerId: ProviderId) => Promise<ModelSetupProviderModelsResult>
  resolveUnlistedModel: (
    providerId: ProviderId,
    modelName: string
  ) => Promise<ModelSetupUnlistedModelMetadata>
  saveCredentials: (
    providerId: ProviderId,
    credentials: Record<string, string>
  ) => Promise<ModelSetupCommandResult>
  selectDefaultModel: (selection: ModelSetupModelSelection) => Promise<ModelSetupCommandResult>
  upsertCustomProvider: (
    provider: CustomProviderInput
  ) => Promise<ModelSetupCustomProviderCommandResult>
}

export interface ModelSetupCommandResult {
  snapshotReady: boolean
}

export interface ModelSetupCustomProviderCommandResult extends ModelSetupCommandResult {
  providerId: ProviderId
}

export interface ModelSetupController {
  commands: ModelSetupCommands
  error: string | null
  loading: boolean
  reload: () => Promise<void>
  snapshot: ModelSetupSnapshot | null
}

let modelSetupSnapshotCache: ModelSetupSnapshot | null = null
let modelSetupSnapshotRequest: Promise<ModelSetupSnapshot> | null = null

function cacheModelSetupSnapshot(snapshot: ModelSetupSnapshot): ModelSetupSnapshot {
  modelSetupSnapshotCache = snapshot
  return snapshot
}

function loadModelSetupSnapshot(force = false): Promise<ModelSetupSnapshot> {
  if (!force) {
    if (modelSetupSnapshotRequest) {
      return modelSetupSnapshotRequest
    }
    if (modelSetupSnapshotCache) {
      return Promise.resolve(modelSetupSnapshotCache)
    }
  }

  const previousRequest = modelSetupSnapshotRequest
  const request = previousRequest
    ? previousRequest.catch(() => undefined).then(() => window.api.models.getSetupSnapshot())
    : window.api.models.getSetupSnapshot()
  modelSetupSnapshotRequest = request.then(cacheModelSetupSnapshot)
  const currentRequest = modelSetupSnapshotRequest
  const clearCurrentRequest = (): void => {
    if (modelSetupSnapshotRequest === currentRequest) {
      modelSetupSnapshotRequest = null
    }
  }
  void currentRequest.then(clearCurrentRequest, clearCurrentRequest)
  return currentRequest
}

export function preloadModelSetupSnapshot(): void {
  void loadModelSetupSnapshot().catch((error: unknown) => {
    console.error("[ModelSetupController] Failed to preload model setup snapshot.", error)
  })
}

export function useModelSetupController(): ModelSetupController {
  const [snapshot, setSnapshot] = useState<ModelSetupSnapshot | null>(modelSetupSnapshotCache)
  const [loading, setLoading] = useState(modelSetupSnapshotCache === null)
  const [error, setError] = useState<string | null>(null)

  const acceptSnapshot = useCallback((nextSnapshot: ModelSetupSnapshot): void => {
    cacheModelSetupSnapshot(nextSnapshot)
    setSnapshot(nextSnapshot)
    setError(null)
  }, [])

  const reload = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      acceptSnapshot(await loadModelSetupSnapshot(true))
    } catch (loadError) {
      console.error("[ModelSetupController] Failed to reload model setup snapshot.", loadError)
      setError(getErrorMessage(loadError))
    } finally {
      setLoading(false)
    }
  }, [acceptSnapshot])

  useEffect(() => {
    let cancelled = false

    async function hydrate(): Promise<void> {
      try {
        const nextSnapshot = await loadModelSetupSnapshot(true)
        if (!cancelled) {
          acceptSnapshot(nextSnapshot)
          setError(null)
        }
      } catch (loadError) {
        if (!cancelled) {
          console.error("[ModelSetupController] Failed to load model setup snapshot.", loadError)
          setError(getErrorMessage(loadError))
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    void hydrate()
    return () => {
      cancelled = true
    }
  }, [acceptSnapshot])

  const refreshAfterMutation = useCallback(async (): Promise<ModelSetupCommandResult> => {
    try {
      acceptSnapshot(await loadModelSetupSnapshot(true))
      return { snapshotReady: true }
    } catch (loadError) {
      console.error(
        "[ModelSetupController] Model setup changed, but the refreshed snapshot failed.",
        loadError
      )
      setError(`模型配置已更新，但读取最新状态失败：${getErrorMessage(loadError)}`)
      return { snapshotReady: false }
    }
  }, [acceptSnapshot])

  const commands = useMemo<ModelSetupCommands>(
    () => ({
      activateProvider: async (providerId) => {
        await window.api.models.activateSetupProvider(providerId)
        return refreshAfterMutation()
      },
      deleteCredentials: async (providerId) => {
        await window.api.models.deleteCredentials(providerId)
        return refreshAfterMutation()
      },
      getCredentials: (providerId) => window.api.models.getCredentials(providerId),
      getCustomProvider: (providerId) => window.api.models.getCustomProvider(providerId),
      refreshProviderModels: async (providerId) => {
        const result = await window.api.models.listSetupProviderModels(providerId)
        acceptSnapshot(result.snapshot)
        return result
      },
      resolveUnlistedModel: (providerId, modelName) =>
        window.api.models.resolveSetupUnlistedModel(providerId, modelName),
      saveCredentials: async (providerId, credentials) => {
        await window.api.models.setCredentials(providerId, credentials)
        return refreshAfterMutation()
      },
      selectDefaultModel: async (selection) => {
        await window.api.models.selectSetupModel(selection)
        return refreshAfterMutation()
      },
      upsertCustomProvider: async (provider) => {
        const providerId = await window.api.models.upsertCustomProvider(provider)
        return {
          providerId,
          ...(await refreshAfterMutation())
        }
      }
    }),
    [acceptSnapshot, refreshAfterMutation]
  )

  return {
    commands,
    error,
    loading,
    reload,
    snapshot
  }
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
