import type { IpcMain } from "electron"
import type { CreateLocalStartItemInput } from "../../shared/local-start"
import {
  listLocalStartItems,
  recordLocalStartItemUse,
  removeLocalStartItem,
  upsertLocalStartItem
} from "../services/local-start"

export function registerLocalStartHandlers(ipcMain: IpcMain): void {
  ipcMain.handle("localStart:list", () => {
    return listLocalStartItems()
  })

  ipcMain.handle("localStart:upsert", (_event, input: CreateLocalStartItemInput) => {
    return upsertLocalStartItem(input)
  })

  ipcMain.handle("localStart:remove", (_event, itemId: string) => {
    removeLocalStartItem(itemId)
  })

  ipcMain.handle("localStart:recordUse", (_event, itemId: string) => {
    return recordLocalStartItemUse(itemId)
  })
}
