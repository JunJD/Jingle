import { getActiveExtensionRuntimeSdk } from "./context"

export type LocalStorageValue = boolean | number | object | string | null

export const LocalStorage = {
  async allItems(): Promise<Record<string, LocalStorageValue>> {
    const response = await getActiveExtensionRuntimeSdk().requestHost({
      capability: "storage",
      method: "all-items",
      payload: {
        scope: "extension"
      }
    })

    if (!response.ok) {
      throw new Error(response.error.message)
    }

    return response.result as Record<string, LocalStorageValue>
  },

  async clear(): Promise<void> {
    const response = await getActiveExtensionRuntimeSdk().requestHost({
      capability: "storage",
      method: "clear",
      payload: {
        scope: "extension"
      }
    })

    if (!response.ok) {
      throw new Error(response.error.message)
    }
  },

  async getItem<TValue = LocalStorageValue>(key: string): Promise<TValue | undefined> {
    const response = await getActiveExtensionRuntimeSdk().requestHost({
      capability: "storage",
      method: "get",
      payload: {
        key,
        scope: "extension"
      }
    })

    if (!response.ok) {
      throw new Error(response.error.message)
    }

    return response.result as TValue | undefined
  },

  async removeItem(key: string): Promise<void> {
    const response = await getActiveExtensionRuntimeSdk().requestHost({
      capability: "storage",
      method: "remove",
      payload: {
        key,
        scope: "extension"
      }
    })

    if (!response.ok) {
      throw new Error(response.error.message)
    }
  },

  async setItem(key: string, value: LocalStorageValue): Promise<void> {
    const response = await getActiveExtensionRuntimeSdk().requestHost({
      capability: "storage",
      method: "set",
      payload: {
        key,
        scope: "extension",
        value
      }
    })

    if (!response.ok) {
      throw new Error(response.error.message)
    }
  }
}
