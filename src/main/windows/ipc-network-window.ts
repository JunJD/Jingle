import { BrowserWindow } from "electron"
import { join } from "path"
import { IPC_NETWORK_WINDOW_KIND } from "@jingle/devtools-network"
import { IPC_NETWORK_PRELOAD_CAPABILITY_ARGUMENT } from "@shared/preload-capability"
import { attachWindowDiagnostics } from "../diagnostics/electron-events"
import { installExternalWindowOpenHandler } from "./external-window-open"
import { startRendererWindowLoad } from "./load-renderer-window"
import { installWindowPresentation, requestWindowPresentation } from "./window-presentation"

const IPC_NETWORK_WINDOW_WIDTH = 1220
const IPC_NETWORK_WINDOW_HEIGHT = 760
const IPC_NETWORK_WINDOW_MIN_WIDTH = 920
const IPC_NETWORK_WINDOW_MIN_HEIGHT = 560

export function createIpcNetworkWindow(): BrowserWindow {
  const isMac = process.platform === "darwin"
  const window = new BrowserWindow({
    width: IPC_NETWORK_WINDOW_WIDTH,
    height: IPC_NETWORK_WINDOW_HEIGHT,
    minWidth: IPC_NETWORK_WINDOW_MIN_WIDTH,
    minHeight: IPC_NETWORK_WINDOW_MIN_HEIGHT,
    show: false,
    autoHideMenuBar: !isMac,
    backgroundColor: "#111318",
    title: "IPC Network",
    webPreferences: {
      additionalArguments: [IPC_NETWORK_PRELOAD_CAPABILITY_ARGUMENT],
      contextIsolation: true,
      nodeIntegration: false,
      preload: join(__dirname, "../preload/index.js"),
      sandbox: false
    }
  })

  const observeRendererWindowLoadFailure = attachWindowDiagnostics(window, IPC_NETWORK_WINDOW_KIND)
  installWindowPresentation(window)

  installExternalWindowOpenHandler(window.webContents)

  startRendererWindowLoad(window, IPC_NETWORK_WINDOW_KIND, {
    onFailure: observeRendererWindowLoadFailure
  })
  return window
}

export function showIpcNetworkWindow(window: BrowserWindow): void {
  requestWindowPresentation(window)
}
