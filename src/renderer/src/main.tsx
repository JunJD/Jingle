import ReactDOM from "react-dom/client"
import {
  setNativeLauncherCatalogProjection,
  setNativeSourceMentionProjection
} from "@extension-host/index"
import { DEFAULT_APP_THEME_SETTINGS } from "@shared/app-theme"
import { IPC_NETWORK_WINDOW_KIND } from "@jingle/devtools-network"
import { applyAppThemeSettings } from "./lib/app-theme"
import { installRendererDiagnostics } from "./lib/diagnostics"
import { RendererRoot } from "./RendererRoot"
import "./index.css"

const windowKind = new URLSearchParams(window.location.search).get("window")
const resolvedWindowKind = windowKind ?? "main"
const platform = window.electron.process.platform

document.documentElement.dataset.window = resolvedWindowKind
document.body.dataset.window = resolvedWindowKind
document.documentElement.dataset.platform = platform
document.body.dataset.platform = platform

installRendererDiagnostics()

applyAppThemeSettings(DEFAULT_APP_THEME_SETTINGS)

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

  const [launcherCatalog, sourceMentions] = await Promise.all([
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
