export type LauncherWindowMode = "default" | "compact"

export interface LauncherSettings {
  useWithDisabledCommandKeys: string[]
  windowMode: LauncherWindowMode
}

export const DEFAULT_LAUNCHER_SETTINGS: LauncherSettings = {
  useWithDisabledCommandKeys: [],
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
    useWithDisabledCommandKeys: Array.isArray(partial.useWithDisabledCommandKeys)
      ? [...new Set(partial.useWithDisabledCommandKeys.filter((key) => typeof key === "string"))]
      : [],
    windowMode: normalizeLauncherWindowMode(partial.windowMode)
  }
}

export function shouldShowLauncherIdleItems(windowMode: LauncherWindowMode): boolean {
  return windowMode === "default"
}
