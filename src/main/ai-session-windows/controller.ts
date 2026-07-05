import type { IpcMain } from "electron"
import type {
  OpenPinnedAiSessionWindowParams,
  OpenPinnedAiSessionWindowResult,
  UpdatePinnedAiSessionWindowThreadParams,
  UpdatePinnedAiSessionWindowThreadResult
} from "@shared/ai-session-window"
import { registerIpcHandle } from "../ipc/handle"
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
        _event,
        params: UpdatePinnedAiSessionWindowThreadParams
      ): UpdatePinnedAiSessionWindowThreadResult => {
        return this.aiSessionWindowsService.updatePinnedWindowThread(params)
      }
    )
  }
}
