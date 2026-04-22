import { BrowserWindow } from "electron"
import type {
  InstalledNativeExtensionSettingsSchema,
  NativeExtensionInvokeRequest,
  NativeExtensionPreferencesChangedEvent
} from "@shared/native-extensions"
import {
  getNativeExtensionCommandPreferenceRecord,
  getNativeExtensionPreferenceRecord,
  setNativeExtensionCommandPreferenceRecord,
  setNativeExtensionPreferenceRecord
} from "../preferences"
import {
  invokeNativeExtension,
  listNativeExtensionSettingsSchemas
} from "../services/native-extensions"

export class NativeExtensionsService {
  listSettingsSchemas(): InstalledNativeExtensionSettingsSchema[] {
    return listNativeExtensionSettingsSchemas()
  }

  getPreferences(extensionName: string): Record<string, unknown> {
    return getNativeExtensionPreferenceRecord(extensionName)
  }

  setPreferences(
    extensionName: string,
    nextRecord: Record<string, unknown>
  ): Record<string, unknown> {
    const record = setNativeExtensionPreferenceRecord(extensionName, nextRecord)
    this.emitPreferencesChanged({
      extensionName,
      scope: "extension"
    })
    return record
  }

  getCommandPreferences(extensionName: string, commandName: string): Record<string, unknown> {
    return getNativeExtensionCommandPreferenceRecord(extensionName, commandName)
  }

  setCommandPreferences(params: {
    commandName: string
    extensionName: string
    nextRecord: Record<string, unknown>
  }): Record<string, unknown> {
    const { commandName, extensionName, nextRecord } = params
    const record = setNativeExtensionCommandPreferenceRecord(
      extensionName,
      commandName,
      nextRecord
    )
    this.emitPreferencesChanged({
      commandName,
      extensionName,
      scope: "command"
    })
    return record
  }

  invoke(request: NativeExtensionInvokeRequest): Promise<unknown> {
    return invokeNativeExtension(request)
  }

  private emitPreferencesChanged(event: NativeExtensionPreferencesChangedEvent): void {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send("nativeExtensions:preferencesChanged", event)
      }
    }
  }
}
