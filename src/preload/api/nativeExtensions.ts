import type {
  NativeExtensionConnectionSecretUpdateRequest,
  NativeExtensionInvokeIpcResponse,
  InstalledNativeExtensionSettingsSchema,
  NativeExtensionInvokeRequest,
  NativeExtensionLauncherCatalogProjection,
  NativeExtensionOAuthStartRequest,
  NativeExtensionOAuthStartResponse,
  NativeExtensionPreferencesChangedEvent,
  NativeExtensionResolvedConnection,
  NativeExtensionSourceMentionProjection
} from "@shared/native-extensions"
import { invokeIpc, ipcRenderer } from "../ipc"
import { JingleIpcClientError } from "../ipc-errors"

export const nativeExtensionsApi = {
  listSettingsSchemas: (): Promise<InstalledNativeExtensionSettingsSchema[]> => {
    return invokeIpc("nativeExtensions:listSettingsSchemas")
  },
  listLauncherCatalog: (): Promise<NativeExtensionLauncherCatalogProjection[]> => {
    return invokeIpc("nativeExtensions:listLauncherCatalog")
  },
  listSourceMentions: (): Promise<NativeExtensionSourceMentionProjection[]> => {
    return invokeIpc("nativeExtensions:listSourceMentions")
  },
  getPreferences: (extensionName: string): Promise<Record<string, unknown>> => {
    return invokeIpc("nativeExtensions:getPreferences", extensionName)
  },
  getConnection: (extensionName: string): Promise<NativeExtensionResolvedConnection> => {
    return invokeIpc("nativeExtensions:getConnection", extensionName)
  },
  setPreferences: (
    extensionName: string,
    nextRecord: Record<string, unknown>
  ): Promise<Record<string, unknown>> => {
    return invokeIpc("nativeExtensions:setPreferences", extensionName, nextRecord)
  },
  getCommandPreferences: (
    extensionName: string,
    commandName: string
  ): Promise<Record<string, unknown>> => {
    return invokeIpc("nativeExtensions:getCommandPreferences", extensionName, commandName)
  },
  setCommandPreferences: (
    extensionName: string,
    commandName: string,
    nextRecord: Record<string, unknown>
  ): Promise<Record<string, unknown>> => {
    return invokeIpc(
      "nativeExtensions:setCommandPreferences",
      extensionName,
      commandName,
      nextRecord
    )
  },
  startOAuthConnection: (
    request: NativeExtensionOAuthStartRequest
  ): Promise<NativeExtensionOAuthStartResponse> => {
    return invokeIpc("nativeExtensions:startOAuthConnection", request)
  },
  setConnectionSecrets: (
    request: NativeExtensionConnectionSecretUpdateRequest
  ): Promise<NativeExtensionResolvedConnection> => {
    return invokeIpc("nativeExtensions:setConnectionSecrets", request)
  },
  invoke: <TPayload, TResult>(
    request: NativeExtensionInvokeRequest<TPayload>
  ): Promise<TResult> => {
    return invokeIpc<NativeExtensionInvokeIpcResponse<TResult>>(
      "nativeExtensions:invoke",
      request
    ).then((response) => {
      if (!response.ok) {
        throw new JingleIpcClientError(response.error)
      }

      return response.result
    })
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
