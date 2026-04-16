import { ipcRenderer } from "electron"
import type {
  InstalledNativeExtensionSettingsSchema,
  NativeExtensionInvokeRequest,
  NativeExtensionPreferencesChangedEvent
} from "../../shared/native-extensions"

export const nativeExtensionsApi = {
  listSettingsSchemas: (): Promise<InstalledNativeExtensionSettingsSchema[]> => {
    return ipcRenderer.invoke("nativeExtensions:listSettingsSchemas")
  },
  getPreferences: (extensionName: string): Promise<Record<string, unknown>> => {
    return ipcRenderer.invoke("nativeExtensions:getPreferences", extensionName)
  },
  setPreferences: (
    extensionName: string,
    nextRecord: Record<string, unknown>
  ): Promise<Record<string, unknown>> => {
    return ipcRenderer.invoke("nativeExtensions:setPreferences", extensionName, nextRecord)
  },
  getCommandPreferences: (
    extensionName: string,
    commandName: string
  ): Promise<Record<string, unknown>> => {
    return ipcRenderer.invoke("nativeExtensions:getCommandPreferences", extensionName, commandName)
  },
  setCommandPreferences: (
    extensionName: string,
    commandName: string,
    nextRecord: Record<string, unknown>
  ): Promise<Record<string, unknown>> => {
    return ipcRenderer.invoke(
      "nativeExtensions:setCommandPreferences",
      extensionName,
      commandName,
      nextRecord
    )
  },
  invoke: <TPayload, TResult>(
    request: NativeExtensionInvokeRequest<TPayload>
  ): Promise<TResult> => {
    return ipcRenderer.invoke("nativeExtensions:invoke", request)
  },
  onPreferencesChanged: (
    callback: (event: NativeExtensionPreferencesChangedEvent) => void
  ): (() => void) => {
    const handler = (_event: unknown, payload: NativeExtensionPreferencesChangedEvent): void => {
      callback(payload)
    }

    ipcRenderer.on("nativeExtensions:preferencesChanged", handler)
    return () => {
      ipcRenderer.removeListener("nativeExtensions:preferencesChanged", handler)
    }
  }
}
