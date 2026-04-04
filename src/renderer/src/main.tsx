import React from "react"
import ReactDOM from "react-dom/client"
import HistoryApp from "@ai-core/history"
import LauncherApp from "@launcher-shell/LauncherApp"
import { LauncherClipboardProvider } from "@launcher-shell/LauncherClipboardContext"
import { ThreadProvider } from "./lib/thread-context"
import { I18nProvider } from "./lib/i18n"
import SettingsApp from "./settings/SettingsApp"
import { DEFAULT_APP_LOCALE, normalizeAppLocale, type AppLocale } from "../../shared/i18n"
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

  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
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
          <HistoryApp />
        )}
      </I18nProvider>
    </React.StrictMode>
  )
}

void bootstrap()
