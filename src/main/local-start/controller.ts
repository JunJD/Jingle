import type { IpcMain } from "electron"
import type { CreateLocalStartItemInput } from "../../shared/local-start"
import { LocalStartService } from "./service"

export class LocalStartController {
  constructor(private readonly localStartService: LocalStartService) {}

  register(ipcMain: IpcMain): void {
    ipcMain.handle("localStart:list", () => {
      return this.localStartService.listItems()
    })

    ipcMain.handle("localStart:upsert", (_event, input: CreateLocalStartItemInput) => {
      return this.localStartService.upsertItem(input)
    })

    ipcMain.handle("localStart:remove", (_event, itemId: string) => {
      this.localStartService.removeItem(itemId)
    })

    ipcMain.handle("localStart:recordUse", (_event, itemId: string) => {
      return this.localStartService.recordItemUse(itemId)
    })
  }
}
