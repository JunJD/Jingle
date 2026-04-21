import type { IpcMain } from "electron"
import { registerIpcHandle } from "../ipc/handle"
import { ExternalLinksService } from "./service"

export class ExternalLinksController {
  constructor(private readonly externalLinksService: ExternalLinksService) {}

  register(ipcMain: IpcMain): void {
    registerIpcHandle(ipcMain, "shell:openExternal", async (_event, url: string) => {
      await this.externalLinksService.openExternal(url)
    })
  }
}
