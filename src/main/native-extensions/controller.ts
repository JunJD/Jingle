import type { IpcMain, IpcMainInvokeEvent } from "electron"
import type {
  NativeExtensionConnectionSecretUpdateRequest,
  NativeExtensionInvokeIpcResponse,
  NativeExtensionInvokeRequest,
  NativeExtensionOAuthStartRequest
} from "@shared/native-extensions"
import { buildIpcErrorPayload } from "../ipc/error"
import { registerIpcHandle } from "../ipc/handle"
import { getWindowIdentity } from "../windows/window-identity"
import { NativeExtensionsService } from "./service"

export class NativeExtensionsController {
  constructor(private readonly nativeExtensionsService: NativeExtensionsService) {}

  register(ipcMain: IpcMain): void {
    registerIpcHandle(ipcMain, "nativeExtensions:listSettingsSchemas", () => {
      return this.nativeExtensionsService.listSettingsSchemas()
    })

    registerIpcHandle(ipcMain, "nativeExtensions:listInstallDiagnostics", (event) => {
      this.assertSettingsSender(event)
      return this.nativeExtensionsService.listInstallDiagnostics()
    })

    registerIpcHandle(ipcMain, "nativeExtensions:listLauncherCatalog", () => {
      return this.nativeExtensionsService.listLauncherCatalog()
    })

    registerIpcHandle(ipcMain, "nativeExtensions:listSourceMentions", () => {
      return this.nativeExtensionsService.listSourceMentions()
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
      "nativeExtensions:getConnection",
      (_event, extensionName: string) => {
        return this.nativeExtensionsService.getConnection(extensionName)
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
      "nativeExtensions:startOAuthConnection",
      (_event, request: NativeExtensionOAuthStartRequest) => {
        return this.nativeExtensionsService.startOAuthConnection(request)
      }
    )

    registerIpcHandle(
      ipcMain,
      "nativeExtensions:setConnectionSecrets",
      (_event, request: NativeExtensionConnectionSecretUpdateRequest) => {
        return this.nativeExtensionsService.setConnectionSecrets(request)
      }
    )

    registerIpcHandle(
      ipcMain,
      "nativeExtensions:invoke",
      async (
        _event,
        request: NativeExtensionInvokeRequest
      ): Promise<NativeExtensionInvokeIpcResponse> => {
        try {
          return {
            ok: true,
            result: await this.nativeExtensionsService.invoke(request)
          }
        } catch (error) {
          return {
            error: buildIpcErrorPayload("nativeExtensions:invoke", error),
            ok: false
          }
        }
      }
    )
  }

  private assertSettingsSender(event: IpcMainInvokeEvent): void {
    if (
      getWindowIdentity(event.sender)?.kind !== "settings" ||
      event.senderFrame !== event.sender.mainFrame
    ) {
      throw new Error("Extension install diagnostics are available only to the Settings window.")
    }
  }
}
