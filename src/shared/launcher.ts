export type LauncherResultKind = "application" | "file" | "directory" | "ai" | "history"

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
  headerHeight: number
  footerHeight: number
  resultItemHeight: number
  maxVisibleResults: number
}

export interface LauncherChromeMeasurement {
  footerHeight?: number
  headerHeight: number
}

export const LAUNCHER_LAYOUT_TOLERANCE_PX = 2

export const MAX_LAUNCHER_SEARCH_RESULTS = 20

export const FALLBACK_SHELL_CONFIG: LauncherShellConfig = {
  headerHeight: 68,
  footerHeight: 46,
  resultItemHeight: 56,
  maxVisibleResults: 8
}

export function getLauncherIdleHeight(
  shellConfig: LauncherShellConfig = FALLBACK_SHELL_CONFIG
): number {
  return shellConfig.headerHeight
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
    return getLauncherIdleHeight(shellConfig)
  }

  return getLauncherIdleHeight(shellConfig) + shellConfig.footerHeight + resultsHeight
}

export function getLauncherMaxViewportHeight(
  shellConfig: LauncherShellConfig = FALLBACK_SHELL_CONFIG
): number {
  return getLauncherViewportHeight(shellConfig.maxVisibleResults, shellConfig)
}

export function getLauncherViewportHeightForBody(
  bodyHeight: number,
  shellConfig: LauncherShellConfig = FALLBACK_SHELL_CONFIG
): number {
  return getLauncherIdleHeight(shellConfig) + shellConfig.footerHeight + Math.max(0, bodyHeight)
}

export function validateLauncherChromeMeasurement(
  shellConfig: LauncherShellConfig,
  measurement: LauncherChromeMeasurement
): string[] {
  const issues: string[] = []

  if (
    Math.abs(measurement.headerHeight - shellConfig.headerHeight) > LAUNCHER_LAYOUT_TOLERANCE_PX
  ) {
    issues.push(
      `header expected ${shellConfig.headerHeight}px but measured ${measurement.headerHeight}px`
    )
  }

  if (
    measurement.footerHeight !== undefined &&
    Math.abs(measurement.footerHeight - shellConfig.footerHeight) > LAUNCHER_LAYOUT_TOLERANCE_PX
  ) {
    issues.push(
      `footer expected ${shellConfig.footerHeight}px but measured ${measurement.footerHeight}px`
    )
  }

  return issues
}
