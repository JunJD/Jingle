import React from "react"
import ReactDOM from "react-dom/client"
import { useEffect, useState } from "react"
import LauncherApp from "@launcher-shell/LauncherApp"
import { LauncherClipboardProvider } from "@launcher-shell/LauncherClipboardContext"
import { setNativeLauncherCatalogProjection } from "@extension-host/index"
import { DEFAULT_APP_THEME_SETTINGS, type AppThemeSettings } from "@shared/app-theme"
import { PINNED_AI_SESSION_WINDOW_KIND } from "@shared/ai-session-window"
import { ThreadProvider } from "./lib/thread-context"
import { applyAppThemeSettings } from "./lib/app-theme"
import { I18nProvider } from "./lib/i18n"
import { PinnedAiSessionWindowApp } from "./ai-core/PinnedAiSessionWindowApp"
import MainWindowApp from "./main-window/MainWindowApp"
import SettingsApp from "./settings/SettingsApp"
import { ShortcutProvider } from "./shortcuts/shortcut-provider"
import { DEFAULT_APP_LOCALE, normalizeAppLocale, type AppLocale } from "@shared/i18n"
import "./index.css"

const windowKind = new URLSearchParams(window.location.search).get("window")
const resolvedWindowKind = windowKind ?? "main"
const platform = window.electron.process.platform

document.documentElement.dataset.window = resolvedWindowKind
document.body.dataset.window = resolvedWindowKind
document.documentElement.dataset.platform = platform
document.body.dataset.platform = platform

async function resolveInitialLocale(): Promise<AppLocale> {
  try {
    const agentConfig = await window.api.settings.getAgentConfig()
    return normalizeAppLocale(agentConfig.locale)
  } catch {
    return DEFAULT_APP_LOCALE
  }
}

async function resolveInitialAppThemeSettings(): Promise<AppThemeSettings> {
  try {
    return await window.api.settings.getAppThemeSettings()
  } catch {
    return DEFAULT_APP_THEME_SETTINGS
  }
}

export function RendererRoot(): React.JSX.Element {
  const [locale, setLocale] = useState<AppLocale>(DEFAULT_APP_LOCALE)
  const shortcutWindowKind =
    resolvedWindowKind === "launcher" || resolvedWindowKind === PINNED_AI_SESSION_WINDOW_KIND
      ? "launcher"
      : resolvedWindowKind === "settings"
        ? "settings"
        : "main"

  useEffect(() => {
    void resolveInitialLocale().then(setLocale)
    void resolveInitialAppThemeSettings().then(applyAppThemeSettings)
    return window.api.settings.onAppThemeSettingsChanged(applyAppThemeSettings)
  }, [])

  return (
    <React.StrictMode>
      <ShortcutProvider windowKind={shortcutWindowKind}>
        <I18nProvider key={locale} initialLocale={locale}>
          {windowKind === "launcher" ? (
            <ThreadProvider>
              <LauncherClipboardProvider>
                <LauncherApp />
              </LauncherClipboardProvider>
            </ThreadProvider>
          ) : windowKind === PINNED_AI_SESSION_WINDOW_KIND ? (
            <ThreadProvider>
              <PinnedAiSessionWindowApp />
            </ThreadProvider>
          ) : windowKind === "settings" ? (
            <SettingsApp />
          ) : (
            <MainWindowApp />
          )}
        </I18nProvider>
      </ShortcutProvider>
    </React.StrictMode>
  )
}

applyAppThemeSettings(DEFAULT_APP_THEME_SETTINGS)

async function bootstrapRenderer(): Promise<void> {
  setNativeLauncherCatalogProjection(await window.api.nativeExtensions.listLauncherCatalog())
  ReactDOM.createRoot(document.getElementById("root")!).render(<RendererRoot />)
}

void bootstrapRenderer().catch((error) => {
  console.error("[native-extensions] Failed to bootstrap renderer launcher catalog.", error)
  throw error
})
