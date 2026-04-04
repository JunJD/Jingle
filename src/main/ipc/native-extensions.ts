import { BrowserWindow, type IpcMain } from "electron"
import {
  getNativeExtensionPreferenceRecord,
  getNativeExtensionCommandPreferenceRecord,
  setNativeExtensionPreferenceRecord,
  setNativeExtensionCommandPreferenceRecord
} from "../preferences"
import {
  invokeNativeExtension,
  listNativeExtensionSettingsSchemas
} from "../services/native-extensions"
import type { NativeExtensionPreferencesChangedEvent } from "../../shared/native-extensions"

function emitNativeExtensionPreferencesChanged(
  event: NativeExtensionPreferencesChangedEvent
): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send("nativeExtensions:preferencesChanged", event)
    }
  }
}

export function registerNativeExtensionHandlers(ipcMain: IpcMain): void {
  ipcMain.handle("nativeExtensions:listSettingsSchemas", () => {
    return listNativeExtensionSettingsSchemas()
  })

  ipcMain.handle("nativeExtensions:getPreferences", (_event, extensionName: string) => {
    return getNativeExtensionPreferenceRecord(extensionName)
  })

  ipcMain.handle(
    "nativeExtensions:setPreferences",
    (_event, extensionName: string, nextRecord: Record<string, unknown>) => {
      const record = setNativeExtensionPreferenceRecord(extensionName, nextRecord)
      emitNativeExtensionPreferencesChanged({
        extensionName,
        scope: "extension"
      })
      return record
    }
  )

  ipcMain.handle(
    "nativeExtensions:getCommandPreferences",
    (_event, extensionName: string, commandName: string) => {
      return getNativeExtensionCommandPreferenceRecord(extensionName, commandName)
    }
  )

  ipcMain.handle(
    "nativeExtensions:setCommandPreferences",
    (_event, extensionName: string, commandName: string, nextRecord: Record<string, unknown>) => {
      const record = setNativeExtensionCommandPreferenceRecord(
        extensionName,
        commandName,
        nextRecord
      )
      emitNativeExtensionPreferencesChanged({
        commandName,
        extensionName,
        scope: "command"
      })
      return record
    }
  )

  ipcMain.handle("nativeExtensions:invoke", (_event, request) => {
    return invokeNativeExtension(request)
  })
}
