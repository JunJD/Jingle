import type { IpcMain } from "electron"
import type { ListOpenTargetsRequest, OpenTargetRequest } from "@shared/open-targets"
import { registerIpcHandle } from "../ipc/handle"
import { OpenTargetsService } from "./service"

export class OpenTargetsController {
  constructor(private readonly openTargetsService: OpenTargetsService) {}

  register(ipcMain: IpcMain): void {
    registerIpcHandle(ipcMain, "openTargets:list", (_event, request: ListOpenTargetsRequest) => {
      return this.openTargetsService.listTargets(request)
    })

    registerIpcHandle(ipcMain, "openTargets:open", async (_event, request: OpenTargetRequest) => {
      await this.openTargetsService.openTarget(request)
    })
  }
}
