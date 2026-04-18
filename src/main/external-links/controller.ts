import type { IpcMain } from "electron"
import { ExternalLinksService } from "./service"

export class ExternalLinksController {
  constructor(private readonly externalLinksService: ExternalLinksService) {}

  register(ipcMain: IpcMain): void {
    ipcMain.handle("shell:openExternal", async (_event, url: string) => {
      await this.externalLinksService.openExternal(url)
    })
  }
}
