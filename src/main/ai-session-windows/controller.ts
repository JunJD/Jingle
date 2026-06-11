import type { IpcMain } from "electron"
import type {
  OpenPinnedAiSessionWindowParams,
  OpenPinnedAiSessionWindowResult
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
  }
}
