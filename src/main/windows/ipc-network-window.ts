import { BrowserWindow } from "electron"
import { join } from "path"
import { IPC_NETWORK_WINDOW_KIND } from "@jingle/devtools-network"
import { IPC_NETWORK_PRELOAD_CAPABILITY_ARGUMENT } from "@shared/preload-capability"
import { attachWindowDiagnostics } from "../diagnostics/electron-events"
import { installExternalWindowOpenHandler } from "./external-window-open"
import { loadRendererWindow } from "./load-renderer-window"

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

  attachWindowDiagnostics(window, IPC_NETWORK_WINDOW_KIND)

  window.on("ready-to-show", () => {
    window.show()
    window.focus()
  })

  installExternalWindowOpenHandler(window.webContents)

  void loadRendererWindow(window, IPC_NETWORK_WINDOW_KIND)
  return window
}

export function showIpcNetworkWindow(window: BrowserWindow): void {
  if (window.isMinimized()) {
    window.restore()
  }

  window.show()
  window.focus()
}
