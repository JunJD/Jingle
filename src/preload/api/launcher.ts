import { ipcRenderer } from "electron"
import type { ClipboardContext } from "../../shared/clipboard"
import type {
  LauncherActionExecutionResult,
  LauncherSearchAction,
  LauncherSearchRequest,
  LauncherSearchResponse
} from "../../shared/launcher-search"

export const launcherApi = {
  getClipboardContext: (): Promise<ClipboardContext> => {
    return ipcRenderer.invoke("launcher:getClipboardContext")
  },
  search: (request: LauncherSearchRequest): Promise<LauncherSearchResponse> => {
    return ipcRenderer.invoke("launcher:search", request)
  },
  executeAction: (action: LauncherSearchAction): Promise<LauncherActionExecutionResult> => {
    return ipcRenderer.invoke("launcher:executeAction", action)
  },
  show: (): Promise<void> => {
    return ipcRenderer.invoke("launcher:show")
  },
  hide: (): Promise<void> => {
    return ipcRenderer.invoke("launcher:hide")
  },
  setViewportHeight: (height: number): Promise<void> => {
    return ipcRenderer.invoke("launcher:setViewportHeight", height)
  },
  onShown: (callback: () => void): (() => void) => {
    const handler = (): void => {
      callback()
    }

    ipcRenderer.on("launcher:shown", handler)
    return () => {
      ipcRenderer.removeListener("launcher:shown", handler)
    }
  }
}
