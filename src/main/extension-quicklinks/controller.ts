import type { IpcMain } from "electron"
import type { UpdateExtensionQuicklinkInput } from "@shared/extension-quicklinks"
import { registerIpcHandle } from "../ipc/handle"
import { ExtensionQuicklinkService } from "./service"

export class ExtensionQuicklinkController {
  constructor(private readonly extensionQuicklinkService: ExtensionQuicklinkService) {}

  register(ipcMain: IpcMain): void {
    registerIpcHandle(ipcMain, "extensionQuicklinks:list", () => {
      return this.extensionQuicklinkService.listQuicklinks()
    })

    registerIpcHandle(
      ipcMain,
      "extensionQuicklinks:update",
      (_event, quicklinkId: string, input: UpdateExtensionQuicklinkInput) => {
        return this.extensionQuicklinkService.updateQuicklink(quicklinkId, input)
      }
    )

    registerIpcHandle(ipcMain, "extensionQuicklinks:remove", (_event, quicklinkId: string) => {
      this.extensionQuicklinkService.removeQuicklink(quicklinkId)
    })
  }
}
