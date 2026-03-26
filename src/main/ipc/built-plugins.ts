import type { IpcMain } from "electron"
import type { BuiltPluginInvokeRequest } from "../../shared/built-plugins/sdk"
import { invokeBuiltPlugin } from "../services/built-plugins"

export function registerBuiltPluginHandlers(ipcMain: IpcMain): void {
  ipcMain.handle("builtPlugins:invoke", async (_event, request: BuiltPluginInvokeRequest) => {
    return invokeBuiltPlugin(request)
  })
}
