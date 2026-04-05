import { app, BrowserWindow, ipcMain, nativeImage } from "electron"
import { join } from "path"
import { installApplicationMenu } from "./app-menu"
import { registerAgentHandlers } from "./ipc/agent"
import { registerLauncherHistoryHandlers } from "./ipc/launcher-history"
import { registerLocalStartHandlers } from "./ipc/local-start"
import { registerThreadHandlers } from "./ipc/threads"
import { registerModelHandlers } from "./ipc/models"
import { registerNativeExtensionHandlers } from "./ipc/native-extensions"
import { registerNativeMenuBarHandlers } from "./ipc/native-menu-bar"
import { registerSettingsWindowHandlers } from "./ipc/settings-window"
import { closeDatabase, initializeDatabase } from "./db"
import { closeRuntime } from "./agent/runtime"
import {
  createLauncherWindow,
  registerLauncherHandlers,
  registerLauncherShortcut,
  showLauncherWindow,
  unregisterLauncherShortcut
} from "./windows/launcher-window"
import { createSettingsWindow, showSettingsWindow } from "./windows/settings-window"
import { warmLauncherSearchProviders } from "./services/launcher-search"
import { initializeNativeMenuBar } from "./services/native-menu-bar"
import type { SettingsWindowNavigationPayload } from "../shared/settings-window"

let launcherWindow: BrowserWindow | null = null
let settingsWindow: BrowserWindow | null = null
let pendingSettingsNavigation: SettingsWindowNavigationPayload | null = null
const bypassSingleInstanceLock = process.env.OPENWORK_BDD === "1"
const hasSingleInstanceLock = bypassSingleInstanceLock ? true : app.requestSingleInstanceLock()

// Simple dev check - replaces @electron-toolkit/utils is.dev
const isDev = !app.isPackaged

function getOrCreateLauncherWindow(): BrowserWindow {
  if (!launcherWindow || launcherWindow.isDestroyed()) {
    launcherWindow = createLauncherWindow()
    launcherWindow.on("closed", () => {
      launcherWindow = null
    })
  }

  return launcherWindow
}

function getOrCreateSettingsWindow(): BrowserWindow {
  if (!settingsWindow || settingsWindow.isDestroyed()) {
    settingsWindow = createSettingsWindow()
    settingsWindow.on("closed", () => {
      settingsWindow = null
    })
  }

  return settingsWindow
}

function openSettingsWindow(payload?: SettingsWindowNavigationPayload): void {
  const settingsWindow = getOrCreateSettingsWindow()

  if (payload && settingsWindow.webContents.isLoadingMainFrame()) {
    pendingSettingsNavigation = payload
  } else {
    pendingSettingsNavigation = null
  }

  showSettingsWindow(settingsWindow, payload)
}

if (!hasSingleInstanceLock) {
  app.quit()
}

if (hasSingleInstanceLock) {
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
    registerNativeExtensionHandlers(ipcMain)
    registerNativeMenuBarHandlers(ipcMain)
    registerSettingsWindowHandlers({
      consumePendingNavigation: () => {
        const pending = pendingSettingsNavigation
        pendingSettingsNavigation = null
        return pending
      },
      ipcMain,
      openSettingsWindow
    })
    registerLauncherHandlers(ipcMain)
    initializeNativeMenuBar({
      getLauncherWindow: () =>
        launcherWindow && !launcherWindow.isDestroyed() ? launcherWindow : null
    })
    void warmLauncherSearchProviders()
    installApplicationMenu({
      isDev,
      showSettings: () => {
        openSettingsWindow()
      },
      showLauncher: () => {
        showLauncherWindow(getOrCreateLauncherWindow())
      }
    })

    showLauncherWindow(getOrCreateLauncherWindow())
    registerLauncherShortcut(getOrCreateLauncherWindow)

    app.on("activate", () => {
      showLauncherWindow(getOrCreateLauncherWindow())
    })
  })
}

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
