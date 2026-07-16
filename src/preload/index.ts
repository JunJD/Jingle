import { contextBridge } from "electron"
import { hasIpcNetworkPreloadCapability } from "@shared/preload-capability"
import { api } from "./api"
import { assertContextIsolation } from "./context-isolation"
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

assertContextIsolation(process.contextIsolated)
try {
  contextBridge.exposeInMainWorld("electron", worldProjection.electron)
  contextBridge.exposeInMainWorld("api", worldProjection.api)
} catch (error) {
  console.error(error)
}
