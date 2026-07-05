import type { IpcMain } from "electron"
import { AppInfoService } from "./service"

export class AppInfoController {
  constructor(private readonly appInfoService: AppInfoService) {}

  register(ipcMain: IpcMain): void {
    ipcMain.on("app:version", (event) => {
      event.returnValue = this.appInfoService.getVersion()
    })
  }
}
