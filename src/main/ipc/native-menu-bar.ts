import type { IpcMain } from "electron"
import type { NativeMenuBarState } from "../../shared/native-menu-bar"
import { clearNativeMenuBarState, setNativeMenuBarState } from "../services/native-menu-bar"

export function registerNativeMenuBarHandlers(ipcMain: IpcMain): void {
  ipcMain.handle("nativeMenuBar:setState", (_event, state: NativeMenuBarState) => {
    setNativeMenuBarState(state)
  })

  ipcMain.handle("nativeMenuBar:clearState", (_event, commandKey: string) => {
    clearNativeMenuBarState(commandKey)
  })
}
