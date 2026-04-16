import { ipcRenderer } from "electron"
import type { CreateLocalStartItemInput, LocalStartItem } from "../../shared/local-start"

export const localStartApi = {
  list: (): Promise<LocalStartItem[]> => {
    return ipcRenderer.invoke("localStart:list")
  },
  upsert: (input: CreateLocalStartItemInput): Promise<LocalStartItem> => {
    return ipcRenderer.invoke("localStart:upsert", input)
  },
  remove: (itemId: string): Promise<void> => {
    return ipcRenderer.invoke("localStart:remove", itemId)
  },
  recordUse: (itemId: string): Promise<LocalStartItem> => {
    return ipcRenderer.invoke("localStart:recordUse", itemId)
  }
}
