export type LauncherWindowMode = "default" | "compact"

export interface LauncherSettings {
  windowMode: LauncherWindowMode
}

export const DEFAULT_LAUNCHER_SETTINGS: LauncherSettings = {
  windowMode: "default"
}

export function normalizeLauncherWindowMode(value: unknown): LauncherWindowMode {
  return value === "compact" ? "compact" : "default"
}

export function normalizeLauncherSettings(value: unknown): LauncherSettings {
  if (!value || typeof value !== "object") {
    return DEFAULT_LAUNCHER_SETTINGS
  }

  const partial = value as Partial<LauncherSettings>
  return {
    windowMode: normalizeLauncherWindowMode(partial.windowMode)
  }
}

export function shouldShowLauncherIdleItems(windowMode: LauncherWindowMode): boolean {
  return windowMode === "default"
}
