import type { ClipboardContext } from "@shared/clipboard"
import type {
  LauncherActionExecutionResult,
  LauncherSearchAction,
  LauncherSearchRequest,
  LauncherSearchResponse
} from "@shared/launcher-search"
import { invokeIpc, ipcRenderer } from "../ipc"

export const launcherApi = {
  getClipboardContext: (): Promise<ClipboardContext> => {
    return invokeIpc("launcher:getClipboardContext")
  },
  search: (request: LauncherSearchRequest): Promise<LauncherSearchResponse> => {
    return invokeIpc("launcher:search", request)
  },
  executeAction: (action: LauncherSearchAction): Promise<LauncherActionExecutionResult> => {
    return invokeIpc("launcher:executeAction", action)
  },
  show: (): Promise<void> => {
    return invokeIpc("launcher:show")
  },
  hide: (): Promise<void> => {
    return invokeIpc("launcher:hide")
  },
  setViewportHeight: (height: number): Promise<void> => {
    return invokeIpc("launcher:setViewportHeight", height)
  },
  onShown: (callback: () => void): (() => void) => {
    const handler = (): void => {
      callback()
    }

    ipcRenderer.on("launcher:shown", handler)
    return () => {
      ipcRenderer.removeListener("launcher:shown", handler)
    }
  },
  onSearchIndexUpdated: (callback: () => void): (() => void) => {
    const handler = (): void => {
      callback()
    }

    ipcRenderer.on("launcher:search-index-updated", handler)
    return () => {
      ipcRenderer.removeListener("launcher:search-index-updated", handler)
    }
  }
}
