import type { IpcMain } from "electron"
import type { NativeMenuBarState } from "../../shared/native-menu-bar"
import { registerIpcHandle } from "../ipc/handle"
import { NativeMenuBarService } from "./service"

export class NativeMenuBarController {
  constructor(private readonly nativeMenuBarService: NativeMenuBarService) {}

  register(ipcMain: IpcMain): void {
    registerIpcHandle(ipcMain, "nativeMenuBar:setState", (_event, state: NativeMenuBarState) => {
      this.nativeMenuBarService.setState(state)
    })

    registerIpcHandle(ipcMain, "nativeMenuBar:clearState", (_event, commandKey: string) => {
      this.nativeMenuBarService.clearState(commandKey)
    })
  }
}
