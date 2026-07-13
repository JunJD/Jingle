import "./observability/bootstrap"
import { app, BrowserWindow, ipcMain, nativeImage, protocol } from "electron"
import { join } from "path"
import { closeDatabase, initializeDatabase } from "./db/lifecycle"
import { closeRuntimeCheckpointers } from "./checkpointer/runtime-checkpointer-manager"
import { createMainCompositionRoot, type MainCompositionRoot } from "./composition-root"
import { createLauncherWindow, showLauncherWindow } from "./windows/launcher-window"
import { createPinnedAiSessionWindow } from "./windows/pinned-ai-session-window"
import { createSettingsWindow, showSettingsWindow } from "./windows/settings-window"
import { registerNativeExtensionAssetProtocol } from "./native-extensions/asset-protocol"
import { NATIVE_EXTENSION_ASSET_PROTOCOL } from "./native-extensions/assets"
import { startNativeMinimalIsland, stopNativeMinimalIsland } from "./services/native-minimal-island"
import { stopNativeSelectionCapture } from "./services/native-selection-capture"
import { installProcessDiagnostics } from "./diagnostics/electron-events"
import { diagnosticsLogger } from "./diagnostics/instance"
import { disposeAppEntry, installAppEntry } from "./app-entry"
import {
  configureDevtoolsNetworkRecorder,
  installBrowserWindowIpcNetworkInstrumentation,
  installIpcMainNetworkInstrumentation
} from "@jingle/devtools-network/main"
import {
  REGISTER_DEV_PROTOCOL_CLIENT_ENV,
  resolveJingleProtocolRegistrationMode
} from "./protocol-client-registration"
import type { SettingsWindowNavigationPayload } from "@shared/settings-window"
import { createIpcNetworkWindow, showIpcNetworkWindow } from "./windows/ipc-network-window"

const JINGLE_PROTOCOL = "jingle"
const APP_DISPLAY_NAME = "Jingle"
const APP_USER_MODEL_ID = "com.jingle.desktop"
const DEV_APP_USER_MODEL_ID = "com.jingle.desktop.dev"

app.setName(APP_DISPLAY_NAME)
app.setAboutPanelOptions({
  applicationName: APP_DISPLAY_NAME
})

const bddJingleHome = process.env.JINGLE_BDD === "1" ? process.env.JINGLE_HOME?.trim() : ""
if (bddJingleHome) {
  app.setPath("userData", join(bddJingleHome, "electron-user-data"))
}

const remoteDebuggingPort = process.env.JINGLE_REMOTE_DEBUGGING_PORT
if (remoteDebuggingPort) {
  // Expose Electron's Chromium target for external CDP clients like agent-browser.
  app.commandLine.appendSwitch("remote-debugging-port", remoteDebuggingPort)
  app.commandLine.appendSwitch("remote-debugging-address", "127.0.0.1")
}

let launcherWindow: BrowserWindow | null = null
let ipcNetworkWindow: BrowserWindow | null = null
let settingsWindow: BrowserWindow | null = null
let mainCompositionRoot: MainCompositionRoot | null = null
let pendingSettingsNavigation: SettingsWindowNavigationPayload | null = null
let settingsRendererReady = false
let pendingOAuthCallbackUrl: string | null = null
let shutdownComplete = false
let shutdownPromise: Promise<void> | null = null
const bypassSingleInstanceLock = process.env.JINGLE_BDD === "1"
const hasSingleInstanceLock = bypassSingleInstanceLock ? true : app.requestSingleInstanceLock()

// Simple dev check - replaces @electron-toolkit/utils is.dev
const isDev = !app.isPackaged
const enableDevtoolsNetwork = !app.isPackaged
configureDevtoolsNetworkRecorder({
  enabled: enableDevtoolsNetwork
})
if (enableDevtoolsNetwork) {
  installIpcMainNetworkInstrumentation(ipcMain)
  installBrowserWindowIpcNetworkInstrumentation({
    app,
    windows: BrowserWindow
  })
}

installProcessDiagnostics({
  handleFatalErrors: !isDev
})

protocol.registerSchemesAsPrivileged([
  {
    privileges: {
      secure: true,
      standard: true,
      supportFetchAPI: true
    },
    scheme: NATIVE_EXTENSION_ASSET_PROTOCOL
  }
])

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
    settingsRendererReady = false
    settingsWindow = createSettingsWindow()
    const createdWindow = settingsWindow
    createdWindow.webContents.on("did-start-loading", () => {
      if (settingsWindow === createdWindow) {
        settingsRendererReady = false
      }
    })
    createdWindow.webContents.on("render-process-gone", () => {
      if (settingsWindow === createdWindow) {
        settingsRendererReady = false
      }
    })
    settingsWindow.on("closed", () => {
      if (settingsWindow === createdWindow) {
        settingsWindow = null
        pendingSettingsNavigation = null
        settingsRendererReady = false
      }
    })
  }

  return settingsWindow
}

function getOrCreateIpcNetworkWindow(): BrowserWindow {
  if (!ipcNetworkWindow || ipcNetworkWindow.isDestroyed()) {
    ipcNetworkWindow = createIpcNetworkWindow()
    ipcNetworkWindow.on("closed", () => {
      ipcNetworkWindow = null
    })
  }

  return ipcNetworkWindow
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

function openSettingsWindow(payload?: SettingsWindowNavigationPayload): void {
  const settingsWindow = getOrCreateSettingsWindow()

  if (payload) {
    pendingSettingsNavigation = settingsRendererReady ? null : payload
  }

  showSettingsWindow(settingsWindow, settingsRendererReady ? payload : undefined)
}

function openIpcNetworkWindow(): void {
  if (!enableDevtoolsNetwork) {
    return
  }

  showIpcNetworkWindow(getOrCreateIpcNetworkWindow())
}

function handleOpenUrl(rawUrl: string): void {
  const parsedUrl = new URL(rawUrl)
  if (parsedUrl.protocol !== `${JINGLE_PROTOCOL}:`) {
    return
  }

  const isOAuthCallback =
    (parsedUrl.hostname === "oauth" && parsedUrl.pathname === "/callback") ||
    parsedUrl.pathname === "/oauth/callback"
  if (!isOAuthCallback) {
    return
  }

  if (!mainCompositionRoot) {
    pendingOAuthCallbackUrl = rawUrl
    return
  }

  void mainCompositionRoot.handleOAuthCallback(rawUrl).catch((error) => {
    console.error("[Main] Failed to handle OAuth callback:", error)
  })
}

function findJingleProtocolUrl(entries: readonly string[]): string | null {
  return entries.find((entry) => entry.startsWith(`${JINGLE_PROTOCOL}://`)) ?? null
}

function registerJingleProtocolClient(): void {
  const mode = resolveJingleProtocolRegistrationMode({
    bypassSingleInstanceLock,
    isDev,
    registerDevProtocolClient: process.env[REGISTER_DEV_PROTOCOL_CLIENT_ENV]
  })

  if (!mode) {
    return
  }

  if (mode === "unregister-dev") {
    app.removeAsDefaultProtocolClient(JINGLE_PROTOCOL, process.execPath, [app.getAppPath()])
    return
  }

  const registered =
    mode === "register-dev"
      ? app.setAsDefaultProtocolClient(JINGLE_PROTOCOL, process.execPath, [app.getAppPath()])
      : app.setAsDefaultProtocolClient(JINGLE_PROTOCOL)

  if (!registered) {
    console.warn(`[Main] Failed to register ${JINGLE_PROTOCOL}:// protocol handler`)
  }
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

async function shutdownMainProcess(): Promise<void> {
  if (shutdownComplete) {
    return
  }

  shutdownPromise ??= (async () => {
    stopNativeMinimalIsland()
    stopNativeSelectionCapture()
    disposeAppEntry()
    await mainCompositionRoot?.dispose()
    mainCompositionRoot = null
    await closeRuntimeCheckpointers()
    await closeDatabase()
    shutdownComplete = true
  })()
  await shutdownPromise
}

if (!hasSingleInstanceLock) {
  app.quit()
}

if (hasSingleInstanceLock) {
  app.on("second-instance", (_event, commandLine) => {
    const protocolUrl = findJingleProtocolUrl(commandLine)
    if (protocolUrl) {
      handleOpenUrl(protocolUrl)
      return
    }

    showLauncher()
  })

  app.on("open-url", (event, rawUrl) => {
    event.preventDefault()
    handleOpenUrl(rawUrl)
  })

  app.whenReady().then(async () => {
    diagnosticsLogger.info("Application ready", {
      appVersion: app.getVersion(),
      electronVersion: process.versions.electron,
      isPackaged: app.isPackaged,
      platform: process.platform
    })

    // Set app user model id for windows
    if (process.platform === "win32") {
      let appUserModelId = APP_USER_MODEL_ID
      if (isDev) {
        appUserModelId = DEV_APP_USER_MODEL_ID
      }
      app.setAppUserModelId(appUserModelId)
    }

    setMacDockIcon()
    registerJingleProtocolClient()
    registerNativeExtensionAssetProtocol()

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
      consumePendingSettingsNavigation: () => {
        const pending = pendingSettingsNavigation
        pendingSettingsNavigation = null
        settingsRendererReady = true
        return pending
      },
      createPinnedAiSessionWindow,
      getLauncherWindow,
      enableDevtoolsNetwork,
      ipcMain,
      isDev,
      openIpcNetworkWindow,
      openSettingsWindow,
      quitApplication: () => app.quit(),
      showLauncherWindow: showLauncher,
      showMainSubject: showLauncher,
      toggleLauncherWindow: toggleLauncher
    })
    mainCompositionRoot.registerIpcHandlers()
    mainCompositionRoot.startServices()
    const launchProtocolUrl = findJingleProtocolUrl(process.argv)
    if (launchProtocolUrl) {
      handleOpenUrl(launchProtocolUrl)
    }
    if (pendingOAuthCallbackUrl) {
      const callbackUrl = pendingOAuthCallbackUrl
      pendingOAuthCallbackUrl = null
      handleOpenUrl(callbackUrl)
    }
    startNativeMinimalIsland({
      openLauncher: showLauncher,
      openMainWindow: showLauncher,
      openSettings: () => openSettingsWindow(),
      quit: () => app.quit()
    })
    installAppEntry({
      openIpcNetwork: enableDevtoolsNetwork ? openIpcNetworkWindow : undefined,
      openLauncher: showLauncher,
      openSettings: () => openSettingsWindow(),
      quit: () => app.quit()
    })

    showLauncher()

    app.on("activate", () => {
      showLauncher()
    })
  })
}

app.on("before-quit", (event) => {
  diagnosticsLogger.info("Application before quit")

  if (shutdownComplete) {
    return
  }

  event.preventDefault()
  void shutdownMainProcess()
    .catch((error) => {
      console.error("[Main] Failed to shut down cleanly:", error)
    })
    .finally(() => {
      shutdownComplete = true
      app.quit()
    })
})

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit()
  }
})
