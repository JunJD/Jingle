import type { IpcMain } from "electron"
import type { NativeExtensionInvokeRequest } from "../../shared/native-extensions"
import { NativeExtensionsService } from "./service"

export class NativeExtensionsController {
  constructor(private readonly nativeExtensionsService: NativeExtensionsService) {}

  register(ipcMain: IpcMain): void {
    ipcMain.handle("nativeExtensions:listSettingsSchemas", () => {
      return this.nativeExtensionsService.listSettingsSchemas()
    })

    ipcMain.handle("nativeExtensions:getPreferences", (_event, extensionName: string) => {
      return this.nativeExtensionsService.getPreferences(extensionName)
    })

    ipcMain.handle(
      "nativeExtensions:setPreferences",
      (_event, extensionName: string, nextRecord: Record<string, unknown>) => {
        return this.nativeExtensionsService.setPreferences(extensionName, nextRecord)
      }
    )

    ipcMain.handle(
      "nativeExtensions:getCommandPreferences",
      (_event, extensionName: string, commandName: string) => {
        return this.nativeExtensionsService.getCommandPreferences(extensionName, commandName)
      }
    )

    ipcMain.handle(
      "nativeExtensions:setCommandPreferences",
      (_event, extensionName: string, commandName: string, nextRecord: Record<string, unknown>) => {
        return this.nativeExtensionsService.setCommandPreferences({
          commandName,
          extensionName,
          nextRecord
        })
      }
    )

    ipcMain.handle("nativeExtensions:invoke", (_event, request: NativeExtensionInvokeRequest) => {
      return this.nativeExtensionsService.invoke(request)
    })
  }
}
