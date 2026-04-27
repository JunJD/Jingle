import { app, BrowserWindow, ipcMain, nativeImage } from "electron"
import { join } from "path"
import { closeDatabase, initializeDatabase } from "./db"
import { closeRuntime } from "./agent/runtime"
import { createMainCompositionRoot, type MainCompositionRoot } from "./composition-root"
import { createLauncherWindow, showLauncherWindow } from "./windows/launcher-window"
import { createMainWindow, showMainWindow } from "./windows/main-window"
import { createSettingsWindow, showSettingsWindow } from "./windows/settings-window"
import { startNativeMinimalIsland, stopNativeMinimalIsland } from "./services/native-minimal-island"
import type { MainWindowNavigationPayload } from "@shared/main-window"
import type { SettingsWindowNavigationPayload } from "@shared/settings-window"

const remoteDebuggingPort = process.env.OPENWORK_REMOTE_DEBUGGING_PORT
if (remoteDebuggingPort) {
  // Expose Electron's Chromium target for external CDP clients like agent-browser.
  app.commandLine.appendSwitch("remote-debugging-port", remoteDebuggingPort)
  app.commandLine.appendSwitch("remote-debugging-address", "127.0.0.1")
}

let launcherWindow: BrowserWindow | null = null
let mainWindow: BrowserWindow | null = null
let settingsWindow: BrowserWindow | null = null
let mainCompositionRoot: MainCompositionRoot | null = null
let pendingMainNavigation: MainWindowNavigationPayload | null = null
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

function getOrCreateMainWindow(): BrowserWindow {
  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = createMainWindow()
    mainWindow.on("closed", () => {
      mainWindow = null
    })
  }

  return mainWindow
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

function getLauncherWindow(): BrowserWindow | null {
  return launcherWindow && !launcherWindow.isDestroyed() ? launcherWindow : null
}

function showLauncher(): void {
  showLauncherWindow(getOrCreateLauncherWindow())
}

function toggleLauncher(): void {
  const launcherWindow = getOrCreateLauncherWindow()
  if (launcherWindow.isVisible()) {
    launcherWindow.hide()
    return
  }

  showLauncherWindow(launcherWindow)
}

function openMainWindow(payload?: MainWindowNavigationPayload): void {
  const mainWindow = getOrCreateMainWindow()
  pendingMainNavigation = payload ?? null
  showMainWindow(mainWindow, payload)
}

function acknowledgePendingMainNavigation(payload: MainWindowNavigationPayload): void {
  if (payload.targetThreadId && pendingMainNavigation?.targetThreadId === payload.targetThreadId) {
    pendingMainNavigation = null
  }
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

function setMacDockIcon(): void {
  if (process.platform !== "darwin" || !app.dock) {
    return
  }

  const iconPath = join(__dirname, "../../resources/icon.png")
  const icon = nativeImage.createFromPath(iconPath)
  if (icon.isEmpty()) {
    throw new Error(`Dock icon is empty: ${iconPath}`)
  }

  app.dock.setIcon(icon)
  app.dock.show()
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

    setMacDockIcon()

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
    mainCompositionRoot = createMainCompositionRoot({
      acknowledgePendingMainNavigation,
      consumePendingSettingsNavigation: () => {
        const pending = pendingSettingsNavigation
        pendingSettingsNavigation = null
        return pending
      },
      getLauncherWindow,
      getPendingMainNavigation: () => pendingMainNavigation,
      ipcMain,
      isDev,
      openMainWindow,
      openSettingsWindow,
      quitApplication: () => app.quit(),
      showLauncherWindow: showLauncher,
      toggleLauncherWindow: toggleLauncher
    })
    mainCompositionRoot.registerIpcHandlers()
    mainCompositionRoot.startServices()
    startNativeMinimalIsland()

    showLauncher()

    app.on("activate", () => {
      openMainWindow()
    })
  })
}

app.on("will-quit", () => {
  stopNativeMinimalIsland()
  mainCompositionRoot?.dispose()
  mainCompositionRoot = null
  void closeRuntime()
  void closeDatabase()
})

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit()
  }
})
