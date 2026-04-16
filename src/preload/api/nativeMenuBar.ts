import { ipcRenderer } from "electron"
import type { NativeMenuBarActionEvent, NativeMenuBarState } from "../../shared/native-menu-bar"

export const nativeMenuBarApi = {
  setState: (state: NativeMenuBarState): Promise<void> => {
    return ipcRenderer.invoke("nativeMenuBar:setState", state)
  },
  clearState: (commandKey: string): Promise<void> => {
    return ipcRenderer.invoke("nativeMenuBar:clearState", commandKey)
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
