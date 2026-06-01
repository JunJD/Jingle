import { getActiveExtensionRuntimeSdk } from "./context"

export function openNativeExtensionSettings(params: {
  commandName?: string
  extensionName?: string
}): Promise<void> {
  const context = getActiveExtensionRuntimeSdk()

  return context
    .requestHost({
      capability: "settings",
      method: "open-extension",
      payload: {
        ...params,
        extensionName: params.extensionName ?? context.extensionName
      }
    })
    .then((response) => {
      if (!response.ok) {
        throw new Error(response.error.message)
      }
    })
}

export function openExtensionPreferences(): Promise<void> {
  return openNativeExtensionSettings({})
}

export function openCommandPreferences(): Promise<void> {
  const context = getActiveExtensionRuntimeSdk()
  return openNativeExtensionSettings({
    commandName: context.commandName,
    extensionName: context.extensionName
  })
}
