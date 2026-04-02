import type { IpcMain } from "electron"
import {
  getNativeExtensionCommandPreferenceRecord,
  setNativeExtensionCommandPreferenceRecord
} from "../preferences"
import { invokeNativeExtension, listNativeExtensionSettingsSchemas } from "../services/native-extensions"

export function registerNativeExtensionHandlers(ipcMain: IpcMain): void {
  ipcMain.handle("nativeExtensions:listSettingsSchemas", () => {
    return listNativeExtensionSettingsSchemas()
  })

  ipcMain.handle(
    "nativeExtensions:getCommandPreferences",
    (_event, extensionName: string, commandName: string) => {
      return getNativeExtensionCommandPreferenceRecord(extensionName, commandName)
    }
  )

  ipcMain.handle(
    "nativeExtensions:setCommandPreferences",
    (_event, extensionName: string, commandName: string, nextRecord: Record<string, unknown>) => {
      return setNativeExtensionCommandPreferenceRecord(extensionName, commandName, nextRecord)
    }
  )

  ipcMain.handle("nativeExtensions:invoke", (_event, request) => {
    return invokeNativeExtension(request)
  })
}
