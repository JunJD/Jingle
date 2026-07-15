import type { IpcMain } from "electron"
import type {
  OpenPinnedAiSessionWindowParams,
  OpenPinnedAiSessionWindowResult,
  UpdatePinnedAiSessionWindowThreadParams,
  UpdatePinnedAiSessionWindowThreadResult
} from "@shared/ai-session-window"
import { registerIpcHandle } from "../ipc/handle"
import { JingleIpcError } from "../ipc/error"
import { AiSessionWindowsService } from "./service"

export class AiSessionWindowsController {
  constructor(private readonly aiSessionWindowsService: AiSessionWindowsService) {}

  register(ipcMain: IpcMain): void {
    registerIpcHandle(
      ipcMain,
      "ai-session-windows:openPinned",
      (_event, params: OpenPinnedAiSessionWindowParams): OpenPinnedAiSessionWindowResult => {
        return this.aiSessionWindowsService.openPinnedWindow(params)
      }
    )

    registerIpcHandle(
      ipcMain,
      "ai-session-windows:updatePinnedThread",
      (
        event,
        params: UpdatePinnedAiSessionWindowThreadParams
      ): UpdatePinnedAiSessionWindowThreadResult => {
        if (event.senderFrame !== event.sender.mainFrame) {
          throw new JingleIpcError({
            channel: "ai-session-windows:updatePinnedThread",
            code: "PERMISSION_DENIED",
            message: "Pinned AI session thread updates require the window's main frame."
          })
        }
        if (!this.aiSessionWindowsService.isPinnedWindowSender(params.windowId, event.sender)) {
          throw new JingleIpcError({
            channel: "ai-session-windows:updatePinnedThread",
            code: "PERMISSION_DENIED",
            message: "Pinned AI session windows can only update their own thread binding."
          })
        }
        return this.aiSessionWindowsService.updatePinnedWindowThread(params)
      }
    )
  }
}
