export type LauncherResultKind = "application" | "ai" | "history"

export type LauncherResultAvailability = "ready" | "planned"

export interface LauncherResultItem {
  id: string
  kind: LauncherResultKind
  title: string
  subtitle: string
  availability?: LauncherResultAvailability
  iconDataUrl?: string
  match?: [number, number]
}

export interface LauncherShellConfig {
  shortcutLabel: string
  placeholder: string
  baseHeight: number
  footerHeight: number
  resultItemHeight: number
  maxVisibleResults: number
}

export const MAX_LAUNCHER_SEARCH_RESULTS = 20

export const FALLBACK_SHELL_CONFIG: LauncherShellConfig = {
  shortcutLabel: "Cmd/Ctrl + Shift + Space",
  placeholder: "Search installed apps.",
  baseHeight: 60,
  footerHeight: 48,
  resultItemHeight: 70,
  maxVisibleResults: 8
}

export function getLauncherResultsHeight(
  resultCount: number,
  shellConfig: LauncherShellConfig = FALLBACK_SHELL_CONFIG
): number {
  return (
    Math.min(Math.max(resultCount, 0), shellConfig.maxVisibleResults) * shellConfig.resultItemHeight
  )
}

export function getLauncherViewportHeight(
  resultCount: number,
  shellConfig: LauncherShellConfig = FALLBACK_SHELL_CONFIG
): number {
  const resultsHeight = getLauncherResultsHeight(resultCount, shellConfig)
  if (resultsHeight === 0) {
    return shellConfig.baseHeight
  }

  return shellConfig.baseHeight + shellConfig.footerHeight + resultsHeight
}

export function getLauncherMaxViewportHeight(
  shellConfig: LauncherShellConfig = FALLBACK_SHELL_CONFIG
): number {
  return getLauncherViewportHeight(shellConfig.maxVisibleResults, shellConfig)
}
