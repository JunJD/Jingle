import React, { useEffect, useState } from "react"
import LauncherApp from "@launcher-shell/LauncherApp"
import { LauncherClipboardProvider } from "@launcher-shell/LauncherClipboardContext"
import { DEFAULT_APP_THEME_SETTINGS, type AppThemeSettings } from "@shared/app-theme"
import { PINNED_AI_SESSION_WINDOW_KIND } from "@shared/ai-session-window"
import { DEFAULT_APP_LOCALE, normalizeAppLocale, type AppLocale } from "@shared/i18n"
import { PinnedAiSessionWindowApp } from "./ai-core/PinnedAiSessionWindowApp"
import { ThreadProvider } from "./lib/thread-context"
import { applyAppThemeSettings } from "./lib/app-theme"
import { I18nProvider } from "./lib/i18n"
import SettingsApp from "./settings/SettingsApp"
import { ShortcutProvider } from "./shortcuts/shortcut-provider"

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

export function RendererRoot(props: {
  resolvedWindowKind: string
  windowKind: string | null
}): React.JSX.Element {
  const { resolvedWindowKind, windowKind } = props
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
          ) : null}
        </I18nProvider>
      </ShortcutProvider>
    </React.StrictMode>
  )
}
