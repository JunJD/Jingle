import type { NativeMenuBarActionEvent, NativeMenuBarState } from "@shared/native-menu-bar"
import { invokeIpc, ipcRenderer } from "../ipc"

export const nativeMenuBarApi = {
  setState: (state: NativeMenuBarState): Promise<void> => {
    return invokeIpc("nativeMenuBar:setState", state)
  },
  clearState: (commandKey: string): Promise<void> => {
    return invokeIpc("nativeMenuBar:clearState", commandKey)
  },
  onItemSelected: (callback: (event: NativeMenuBarActionEvent) => void): (() => void) => {
    const handler = (_event: unknown, payload: NativeMenuBarActionEvent): void => {
      callback(payload)
    }

    ipcRenderer.on("nativeMenuBar:itemSelected", handler)
    return () => {
      ipcRenderer.removeListener("nativeMenuBar:itemSelected", handler)
    }
  }
}
