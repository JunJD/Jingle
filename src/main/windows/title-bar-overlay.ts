import type { BrowserWindow, TitleBarOverlay } from "electron"
import { resolveAppThemeWindowChrome, type AppThemeSettings } from "@shared/app-theme"

export function createThemeTitleBarOverlay(settings: AppThemeSettings): TitleBarOverlay {
  const chrome = resolveAppThemeWindowChrome(settings.config)

  return {
    color: chrome.background,
    symbolColor: chrome.foreground
  }
}

export function updateThemeTitleBarOverlay(
  window: BrowserWindow,
  settings: AppThemeSettings
): void {
  window.setTitleBarOverlay(createThemeTitleBarOverlay(settings))
}
