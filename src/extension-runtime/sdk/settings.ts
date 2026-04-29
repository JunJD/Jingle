import { getActiveExtensionRuntimeSdk } from "./context"

export function openNativeExtensionSettings(params: {
  commandName?: string
  extensionName: string
}): Promise<void> {
  return getActiveExtensionRuntimeSdk()
    .requestHost({
      capability: "settings",
      method: "open-extension",
      payload: params
    })
    .then((response) => {
      if (!response.ok) {
        throw new Error(response.error.message)
      }
    })
}
