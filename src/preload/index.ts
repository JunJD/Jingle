import { contextBridge } from "electron"
import { hasIpcNetworkPreloadCapability } from "@shared/preload-capability"
import { api } from "./api"
import { electronAPI } from "./electron-api"

declare global {
  interface Window {
    electron: typeof electronAPI
    api: typeof api
  }
}

const ipcNetworkWorldProjection = {
  api: {
    diagnostics: {
      reportRendererError: api.diagnostics.reportRendererError
    },
    devtools: {
      ipcNetwork: {
        clear: api.devtools.ipcNetwork.clear,
        list: api.devtools.ipcNetwork.list
      }
    }
  },
  electron: {
    process: {
      platform: electronAPI.process.platform
    }
  }
}

const worldProjection = hasIpcNetworkPreloadCapability(process.argv)
  ? ipcNetworkWorldProjection
  : {
      api,
      electron: electronAPI
    }

// Use `contextBridge` APIs to expose Electron APIs to renderer
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld("electron", worldProjection.electron)
    contextBridge.exposeInMainWorld("api", worldProjection.api)
  } catch (error) {
    console.error(error)
  }
} else {
  const rendererWindow = window as unknown as Record<"api" | "electron", unknown>
  rendererWindow.electron = worldProjection.electron
  rendererWindow.api = worldProjection.api
}
