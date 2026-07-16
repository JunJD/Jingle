import ReactDOM from "react-dom/client"
import {
  setNativeLauncherCatalogProjection,
  setNativeSourceMentionProjection
} from "@extension-host/index"
import {
  APP_THEME_RENDERER_QUERY_KEY,
  DEFAULT_APP_THEME_SETTINGS,
  parseJingleThemeV1Token
} from "@shared/app-theme"
import { IPC_NETWORK_WINDOW_KIND } from "@jingle/devtools-network"
import { applyAppThemeSettings, applyJingleTheme } from "./lib/app-theme"
import { installRendererDiagnostics } from "./lib/diagnostics"
import { installInputModalityTracking } from "./lib/input-modality"
import { RendererRoot } from "./RendererRoot"
import "./index.css"

const rendererQuery = new URLSearchParams(window.location.search)
const windowKind = rendererQuery.get("window")
const supportedWindowKinds = new Set([
  "main",
  "thread-window",
  "launcher",
  "settings",
  IPC_NETWORK_WINDOW_KIND
])
if (!windowKind || !supportedWindowKinds.has(windowKind)) {
  throw new Error(`Renderer startup received an invalid window kind: ${windowKind ?? "missing"}.`)
}
const resolvedWindowKind = windowKind
const platform = window.electron.process.platform

document.documentElement.dataset.window = resolvedWindowKind
document.body.dataset.window = resolvedWindowKind
if (resolvedWindowKind === "main" || resolvedWindowKind === "thread-window") {
  document.documentElement.dataset.windowSurface = "durable"
  document.body.dataset.windowSurface = "durable"
}
document.documentElement.dataset.platform = platform
document.body.dataset.platform = platform

installRendererDiagnostics()
installInputModalityTracking()

function applyStartupAppTheme(): void {
  if (resolvedWindowKind === IPC_NETWORK_WINDOW_KIND) {
    applyAppThemeSettings(DEFAULT_APP_THEME_SETTINGS)
    return
  }

  const token = rendererQuery.get(APP_THEME_RENDERER_QUERY_KEY)
  const theme = token ? parseJingleThemeV1Token(token) : null
  if (!theme) {
    throw new Error("Renderer startup is missing its app theme projection.")
  }

  applyJingleTheme(theme)
}

function installAppThemeProjection(): Promise<void> {
  let liveThemeRevision = 0
  const unsubscribe = window.api.settings.onAppThemeSettingsChanged((settings) => {
    liveThemeRevision += 1
    applyAppThemeSettings(settings)
  })
  window.addEventListener("beforeunload", () => unsubscribe(), { once: true })

  const initialRevision = liveThemeRevision
  return window.api.settings
    .getAppThemeSettings()
    .then((settings) => {
      if (liveThemeRevision === initialRevision) {
        applyAppThemeSettings(settings)
      }
    })
    .catch((error: unknown) => {
      console.error("[renderer] Failed to refresh the startup app theme projection.", error)
    })
}

applyStartupAppTheme()
const appThemeProjectionReady =
  resolvedWindowKind === IPC_NETWORK_WINDOW_KIND ? Promise.resolve() : installAppThemeProjection()

function renderRoot(): void {
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <RendererRoot resolvedWindowKind={resolvedWindowKind} windowKind={windowKind} />
  )
}

async function bootstrapRenderer(): Promise<void> {
  if (resolvedWindowKind === IPC_NETWORK_WINDOW_KIND) {
    renderRoot()
    return
  }

  const [, launcherCatalog, sourceMentions] = await Promise.all([
    appThemeProjectionReady,
    window.api.nativeExtensions.listLauncherCatalog(),
    window.api.nativeExtensions.listSourceMentions()
  ])
  setNativeLauncherCatalogProjection(launcherCatalog)
  setNativeSourceMentionProjection(sourceMentions)
  renderRoot()
}

void bootstrapRenderer().catch((error) => {
  console.error("[native-extensions] Failed to bootstrap renderer launcher catalog.", error)
  throw error
})
