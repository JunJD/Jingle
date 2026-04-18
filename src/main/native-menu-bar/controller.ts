import type { IpcMain } from "electron"
import type { NativeMenuBarState } from "../../shared/native-menu-bar"
import { NativeMenuBarService } from "./service"

export class NativeMenuBarController {
  constructor(private readonly nativeMenuBarService: NativeMenuBarService) {}

  register(ipcMain: IpcMain): void {
    ipcMain.handle("nativeMenuBar:setState", (_event, state: NativeMenuBarState) => {
      this.nativeMenuBarService.setState(state)
    })

    ipcMain.handle("nativeMenuBar:clearState", (_event, commandKey: string) => {
      this.nativeMenuBarService.clearState(commandKey)
    })
  }
}
