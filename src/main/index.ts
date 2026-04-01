import { app, shell, BrowserWindow, ipcMain, nativeImage } from "electron"
import { join, resolve } from "path"
import { installApplicationMenu } from "./app-menu"
import { registerAgentHandlers } from "./ipc/agent"
import { registerOAuthHandlers } from "./ipc/oauth"
import { registerLauncherHistoryHandlers } from "./ipc/launcher-history"
import { registerLocalStartHandlers } from "./ipc/local-start"
import { registerThreadHandlers } from "./ipc/threads"
import { registerModelHandlers } from "./ipc/models"
import { registerBuiltPluginHandlers } from "./ipc/built-plugins"
import { registerExternalExtensionHandlers } from "./ipc/extensions"
import { registerSettingsWindowHandlers } from "./ipc/settings-window"
import { setOAuthToken } from "./oauth-store"
import { closeDatabase, initializeDatabase } from "./db"
import { closeRuntime } from "./agent/runtime"
import {
  createLauncherWindow,
  registerLauncherHandlers,
  registerLauncherShortcut,
  setLauncherBlurHideSuppressed,
  showLauncherWindow,
  unregisterLauncherShortcut
} from "./windows/launcher-window"
import { loadRendererWindow } from "./windows/load-renderer-window"
import { createSettingsWindow, showSettingsWindow } from "./windows/settings-window"
import {
  attachMainWindowStatePersistence,
  getMainWindowPlacement
} from "./windows/main-window-state"
import { warmLauncherSearchProviders } from "./services/launcher-search"
import type { SettingsWindowNavigationPayload } from "../shared/settings-window"

let mainWindow: BrowserWindow | null = null
let launcherWindow: BrowserWindow | null = null
let settingsWindow: BrowserWindow | null = null
let pendingSettingsNavigation: SettingsWindowNavigationPayload | null = null
const OAUTH_PROTOCOL_SCHEME = "openwork"
const hasSingleInstanceLock = app.requestSingleInstanceLock()

// Simple dev check - replaces @electron-toolkit/utils is.dev
const isDev = !app.isPackaged

function registerOpenworkProtocol(): void {
  if (process.defaultApp) {
    app.setAsDefaultProtocolClient(OAUTH_PROTOCOL_SCHEME, process.execPath, [
      resolve(process.argv[1] ?? "")
    ])
    return
  }

  app.setAsDefaultProtocolClient(OAUTH_PROTOCOL_SCHEME)
}

function handleOAuthCallbackUrl(rawUrl: string): void {
  if (!rawUrl) {
    return
  }

  let parsedUrl: URL

  try {
    parsedUrl = new URL(rawUrl)
  } catch {
    return
  }

  if (parsedUrl.protocol !== `${OAUTH_PROTOCOL_SCHEME}:`) {
    return
  }

  const isOAuthCallback =
    (parsedUrl.hostname === "oauth" && parsedUrl.pathname === "/callback") ||
    parsedUrl.pathname === "/oauth/callback" ||
    (parsedUrl.hostname === "auth" && parsedUrl.pathname === "/callback") ||
    parsedUrl.pathname === "/auth/callback"

  if (!isOAuthCallback) {
    return
  }

  setLauncherBlurHideSuppressed(false)

  const provider = parsedUrl.searchParams.get("provider") ?? ""
  const accessToken = parsedUrl.searchParams.get("access_token") ?? ""
  if (provider && accessToken) {
    const rawExpiresIn = parsedUrl.searchParams.get("expires_in")
    const expiresIn = rawExpiresIn ? Number.parseInt(rawExpiresIn, 10) : undefined
    const refreshToken = parsedUrl.searchParams.get("refresh_token") ?? undefined
    const idToken = parsedUrl.searchParams.get("id_token") ?? undefined
    setOAuthToken(provider, {
      accessToken,
      ...(Number.isFinite(expiresIn) ? { expiresIn } : {}),
      ...(refreshToken ? { refreshToken } : {}),
      ...(idToken ? { idToken } : {}),
      obtainedAt: new Date().toISOString(),
      scope: parsedUrl.searchParams.get("scope") ?? undefined,
      tokenType: parsedUrl.searchParams.get("token_type") ?? "Bearer"
    })
  }

  if (launcherWindow && !launcherWindow.isDestroyed()) {
    launcherWindow.webContents.send("oauth:callback", rawUrl)
  }
}

function getOAuthCallbackArg(argv: readonly string[]): string | null {
  return argv.find((arg) => arg.startsWith(`${OAUTH_PROTOCOL_SCHEME}://`)) ?? null
}

function createWindow(): void {
  const isMac = process.platform === "darwin"
  const placement = getMainWindowPlacement()

  mainWindow = new BrowserWindow({
    ...placement.bounds,
    minWidth: 1200,
    minHeight: 700,
    show: false,
    autoHideMenuBar: !isMac,
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

  attachMainWindowStatePersistence(mainWindow)

  mainWindow.on("ready-to-show", () => {
    if (!mainWindow) {
      return
    }

    mainWindow.show()
    if (placement.isMaximized) {
      mainWindow.maximize()
    }
    mainWindow.focus()
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
} else {
  app.on("second-instance", (_event, argv) => {
    const oauthCallbackUrl = getOAuthCallbackArg(argv)
    if (oauthCallbackUrl) {
      handleOAuthCallbackUrl(oauthCallbackUrl)
    }
  })

  app.on("open-url", (event, url) => {
    event.preventDefault()
    handleOAuthCallbackUrl(url)
  })
}

if (hasSingleInstanceLock) {
  app.whenReady().then(async () => {
    // Set app user model id for windows
    if (process.platform === "win32") {
      app.setAppUserModelId(isDev ? process.execPath : "com.langchain.openwork")
    }

    registerOpenworkProtocol()

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
    registerBuiltPluginHandlers(ipcMain)
    registerOAuthHandlers({
      getLauncherWindow: () => launcherWindow,
      ipcMain,
      setFlowActive: setLauncherBlurHideSuppressed
    })
    registerExternalExtensionHandlers(ipcMain)
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

    createWindow()
    getOrCreateLauncherWindow()
    registerLauncherShortcut(getOrCreateLauncherWindow)

    app.on("activate", () => {
      if (!mainWindow || mainWindow.isDestroyed()) {
        createWindow()
      }
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
