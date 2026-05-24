import type { CreateLocalStartItemInput, LocalStartItem } from "@shared/local-start"
import { invokeIpc } from "../ipc"

export const localStartApi = {
  list: (): Promise<LocalStartItem[]> => {
    return invokeIpc("localStart:list")
  },
  upsert: (input: CreateLocalStartItemInput): Promise<LocalStartItem> => {
    return invokeIpc("localStart:upsert", input)
  },
  remove: (itemId: string): Promise<void> => {
    return invokeIpc("localStart:remove", itemId)
  },
  recordUse: (itemId: string): Promise<LocalStartItem> => {
    return invokeIpc("localStart:recordUse", itemId)
  }
}
