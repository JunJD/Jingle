import type { BrowserWindow, TitleBarOverlay } from "electron"
import { resolveAppThemeWindowChrome, type AppThemeSettings } from "@shared/app-theme"

interface ThemeTitleBarOverlayOptions {
  height?: number
}

export function createThemeTitleBarOverlay(
  settings: AppThemeSettings,
  options: ThemeTitleBarOverlayOptions = {}
): TitleBarOverlay {
  const chrome = resolveAppThemeWindowChrome(settings.config)

  return {
    color: chrome.background,
    symbolColor: chrome.foreground,
    ...(options.height === undefined ? {} : { height: options.height })
  }
}

export function updateThemeTitleBarOverlay(
  window: BrowserWindow,
  settings: AppThemeSettings,
  options: ThemeTitleBarOverlayOptions = {}
): void {
  window.setTitleBarOverlay(createThemeTitleBarOverlay(settings, options))
}
