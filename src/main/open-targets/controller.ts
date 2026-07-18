import type { IpcMain, IpcMainInvokeEvent } from "electron"
import {
  listOpenTargetsArgsSchema,
  listOpenTargetsResponseSchema,
  openTargetArgsSchema
} from "@shared/open-targets"
import { registerValidatedIpcHandle } from "../ipc/handle"
import { getWindowIdentity, isDurableWindowIdentity } from "../windows/window-identity"
import { OpenTargetsService } from "./service"

export class OpenTargetsController {
  constructor(private readonly openTargetsService: OpenTargetsService) {}

  register(ipcMain: IpcMain): void {
    registerValidatedIpcHandle(
      ipcMain,
      "openTargets:list",
      listOpenTargetsArgsSchema,
      async (event, request) => {
        this.assertOpenTargetsSender(event)
        return listOpenTargetsResponseSchema.parse(
          await this.openTargetsService.listTargets(request)
        )
      }
    )

    registerValidatedIpcHandle(
      ipcMain,
      "openTargets:open",
      openTargetArgsSchema,
      async (event, request) => {
        this.assertOpenTargetsSender(event)
        await this.openTargetsService.openTarget(request)
      }
    )
  }

  private assertOpenTargetsSender(event: IpcMainInvokeEvent): void {
    const identity = getWindowIdentity(event.sender)
    if (
      event.senderFrame !== event.sender.mainFrame ||
      (identity?.kind !== "launcher" && !isDurableWindowIdentity(identity))
    ) {
      throw new Error("Open targets can only be accessed by the Launcher or a durable window.")
    }
  }
}
