import React, { useEffect, useState } from "react"
import LauncherApp from "@launcher-shell/LauncherApp"
import { LauncherClipboardProvider } from "@launcher-shell/LauncherClipboardContext"
import { LauncherSelectionProvider } from "@launcher-shell/LauncherSelectionContext"
import { DEFAULT_APP_LOCALE, normalizeAppLocale, type AppLocale } from "@shared/i18n"
import { IPC_NETWORK_WINDOW_KIND } from "@jingle/devtools-network"
import { TooltipProvider } from "@/components/ui/tooltip"
import { I18nProvider } from "@/lib/i18n"
import { DurableWindowApp } from "./ai-core/MainWindowApp"
import { IpcNetworkApp } from "./devtools/IpcNetworkApp"
import { ThreadProvider } from "./lib/thread-context"
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

export function RendererRoot(props: {
  resolvedWindowKind: string
  windowKind: string | null
}): React.JSX.Element {
  if (props.windowKind === IPC_NETWORK_WINDOW_KIND) {
    return (
      <React.StrictMode>
        <TooltipProvider>
          <IpcNetworkApp />
        </TooltipProvider>
      </React.StrictMode>
    )
  }

  return <AppRendererRoot {...props} />
}

function AppRendererRoot(props: {
  resolvedWindowKind: string
  windowKind: string | null
}): React.JSX.Element {
  const { resolvedWindowKind, windowKind } = props
  const [locale, setLocale] = useState<AppLocale>(DEFAULT_APP_LOCALE)
  const shortcutWindowKind =
    resolvedWindowKind === "launcher"
      ? "launcher"
      : resolvedWindowKind === "settings"
        ? "settings"
        : "main"

  useEffect(() => {
    void resolveInitialLocale().then(setLocale)
  }, [])

  return (
    <React.StrictMode>
      <TooltipProvider>
        <ShortcutProvider windowKind={shortcutWindowKind}>
          <I18nProvider key={locale} initialLocale={locale}>
            {windowKind === "launcher" ? (
              <ThreadProvider eventSurface="launcher">
                <LauncherClipboardProvider>
                  <LauncherSelectionProvider>
                    <LauncherApp />
                  </LauncherSelectionProvider>
                </LauncherClipboardProvider>
              </ThreadProvider>
            ) : windowKind === "main" || windowKind === "thread-window" ? (
              <ThreadProvider eventSurface="main">
                <DurableWindowApp />
              </ThreadProvider>
            ) : windowKind === "settings" ? (
              <SettingsApp />
            ) : null}
          </I18nProvider>
        </ShortcutProvider>
      </TooltipProvider>
    </React.StrictMode>
  )
}
