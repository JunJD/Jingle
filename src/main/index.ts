import { app, shell, BrowserWindow, ipcMain, nativeImage } from "electron"
import { join } from "path"
import { registerAgentHandlers } from "./ipc/agent"
import { registerLauncherHistoryHandlers } from "./ipc/launcher-history"
import { registerLocalStartHandlers } from "./ipc/local-start"
import { registerThreadHandlers } from "./ipc/threads"
import { registerModelHandlers } from "./ipc/models"
import { closeDatabase, initializeDatabase } from "./db"
import { closeRuntime } from "./agent/runtime"
import {
  createLauncherWindow,
  registerLauncherHandlers,
  registerLauncherShortcut,
  unregisterLauncherShortcut
} from "./windows/launcher-window"
import { loadRendererWindow } from "./windows/load-renderer-window"
import { warmLauncherSearchProviders } from "./services/launcher-search"

let mainWindow: BrowserWindow | null = null
let launcherWindow: BrowserWindow | null = null

// Simple dev check - replaces @electron-toolkit/utils is.dev
const isDev = !app.isPackaged

function createWindow(): void {
  const isMac = process.platform === "darwin"

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1200,
    minHeight: 700,
    show: false,
    backgroundColor: "#F3F4F1",
    titleBarStyle: "hidden",
    ...(isMac
      ? {
          trafficLightPosition: { x: 16, y: 16 }
        }
      : {
          titleBarOverlay: {
            color: "#F7F6F2",
            symbolColor: "#5F6873",
            height: 52
          }
        }),
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: false
    }
  })

  mainWindow.on("ready-to-show", () => {
    mainWindow?.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: "deny" }
  })

  void loadRendererWindow(mainWindow, "main")

  mainWindow.on("closed", () => {
    if (launcherWindow && !launcherWindow.isDestroyed()) {
      launcherWindow.close()
      launcherWindow = null
    }
    mainWindow = null
  })
}

function getOrCreateLauncherWindow(): BrowserWindow {
  if (!launcherWindow || launcherWindow.isDestroyed()) {
    launcherWindow = createLauncherWindow()
    launcherWindow.on("closed", () => {
      launcherWindow = null
    })
  }

  return launcherWindow
}

app.whenReady().then(async () => {
  // Set app user model id for windows
  if (process.platform === "win32") {
    app.setAppUserModelId(isDev ? process.execPath : "com.langchain.openwork")
  }

  // Set dock icon on macOS
  if (process.platform === "darwin" && app.dock) {
    const iconPath = join(__dirname, "../../resources/icon.png")
    try {
      const icon = nativeImage.createFromPath(iconPath)
      if (!icon.isEmpty()) {
        app.dock.setIcon(icon)
      }
    } catch {
      // Icon not found, use default
    }
  }

  // Default open or close DevTools by F12 in development
  if (isDev) {
    app.on("browser-window-created", (_, window) => {
      window.webContents.on("before-input-event", (event, input) => {
        if (input.key === "F12") {
          window.webContents.toggleDevTools()
          event.preventDefault()
        }
      })
    })
  }

  // Initialize database
  await initializeDatabase()

  // Register IPC handlers
  registerAgentHandlers(ipcMain)
  registerLauncherHistoryHandlers(ipcMain)
  registerLocalStartHandlers(ipcMain)
  registerThreadHandlers(ipcMain)
  registerModelHandlers(ipcMain)
  registerLauncherHandlers(ipcMain)
  void warmLauncherSearchProviders()

  createWindow()
  getOrCreateLauncherWindow()
  registerLauncherShortcut(getOrCreateLauncherWindow)

  app.on("activate", () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      createWindow()
    }
  })
})

app.on("will-quit", () => {
  unregisterLauncherShortcut()
  void closeRuntime()
  void closeDatabase()
})

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit()
  }
})
