import type {
  ExtensionQuicklinkRecord,
  UpdateExtensionQuicklinkInput
} from "@shared/extension-quicklinks"
import { invokeIpc } from "../ipc"

export const extensionQuicklinksApi = {
  list: (): Promise<ExtensionQuicklinkRecord[]> => {
    return invokeIpc("extensionQuicklinks:list")
  },
  remove: (quicklinkId: string): Promise<void> => {
    return invokeIpc("extensionQuicklinks:remove", quicklinkId)
  },
  update: (
    quicklinkId: string,
    input: UpdateExtensionQuicklinkInput
  ): Promise<ExtensionQuicklinkRecord> => {
    return invokeIpc("extensionQuicklinks:update", quicklinkId, input)
  }
}
