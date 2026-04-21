import type { IpcMain } from "electron"
import type { CreateLocalStartItemInput } from "@shared/local-start"
import { registerIpcHandle } from "../ipc/handle"
import { LocalStartService } from "./service"

export class LocalStartController {
  constructor(private readonly localStartService: LocalStartService) {}

  register(ipcMain: IpcMain): void {
    registerIpcHandle(ipcMain, "localStart:list", () => {
      return this.localStartService.listItems()
    })

    registerIpcHandle(ipcMain, "localStart:upsert", (_event, input: CreateLocalStartItemInput) => {
      return this.localStartService.upsertItem(input)
    })

    registerIpcHandle(ipcMain, "localStart:remove", (_event, itemId: string) => {
      this.localStartService.removeItem(itemId)
    })

    registerIpcHandle(ipcMain, "localStart:recordUse", (_event, itemId: string) => {
      return this.localStartService.recordItemUse(itemId)
    })
  }
}
