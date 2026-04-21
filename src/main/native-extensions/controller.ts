import type { IpcMain } from "electron"
import type { NativeExtensionInvokeRequest } from "../../shared/native-extensions"
import { registerIpcHandle } from "../ipc/handle"
import { NativeExtensionsService } from "./service"

export class NativeExtensionsController {
  constructor(private readonly nativeExtensionsService: NativeExtensionsService) {}

  register(ipcMain: IpcMain): void {
    registerIpcHandle(ipcMain, "nativeExtensions:listSettingsSchemas", () => {
      return this.nativeExtensionsService.listSettingsSchemas()
    })

    registerIpcHandle(
      ipcMain,
      "nativeExtensions:getPreferences",
      (_event, extensionName: string) => {
        return this.nativeExtensionsService.getPreferences(extensionName)
      }
    )

    registerIpcHandle(
      ipcMain,
      "nativeExtensions:setPreferences",
      (_event, extensionName: string, nextRecord: Record<string, unknown>) => {
        return this.nativeExtensionsService.setPreferences(extensionName, nextRecord)
      }
    )

    registerIpcHandle(
      ipcMain,
      "nativeExtensions:getCommandPreferences",
      (_event, extensionName: string, commandName: string) => {
        return this.nativeExtensionsService.getCommandPreferences(extensionName, commandName)
      }
    )

    registerIpcHandle(
      ipcMain,
      "nativeExtensions:setCommandPreferences",
      (_event, extensionName: string, commandName: string, nextRecord: Record<string, unknown>) => {
        return this.nativeExtensionsService.setCommandPreferences({
          commandName,
          extensionName,
          nextRecord
        })
      }
    )

    registerIpcHandle(
      ipcMain,
      "nativeExtensions:invoke",
      (_event, request: NativeExtensionInvokeRequest) => {
        return this.nativeExtensionsService.invoke(request)
      }
    )
  }
}
