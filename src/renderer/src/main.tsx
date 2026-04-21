import React from "react"
import ReactDOM from "react-dom/client"
import LauncherApp from "@launcher-shell/LauncherApp"
import { LauncherClipboardProvider } from "@launcher-shell/LauncherClipboardContext"
import { ThreadProvider } from "./lib/thread-context"
import { I18nProvider } from "./lib/i18n"
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

async function bootstrap(): Promise<void> {
  const initialLocale = await resolveInitialLocale()
  const shortcutWindowKind =
    resolvedWindowKind === "launcher"
      ? "launcher"
      : resolvedWindowKind === "settings"
        ? "settings"
        : "main"

  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <ShortcutProvider windowKind={shortcutWindowKind}>
        <I18nProvider initialLocale={initialLocale}>
          {windowKind === "launcher" ? (
            <ThreadProvider>
              <LauncherClipboardProvider>
                <LauncherApp />
              </LauncherClipboardProvider>
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

void bootstrap()
