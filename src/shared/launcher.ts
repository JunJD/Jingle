export type LauncherResultKind = "application" | "ai" | "history"

export type LauncherResultAvailability = "ready" | "planned"

export interface LauncherResultItem {
  id: string
  kind: LauncherResultKind
  title: string
  subtitle: string
  trailingLabel: string
  availability?: LauncherResultAvailability
}

export interface LauncherShellConfig {
  shortcutLabel: string
  placeholder: string
  baseHeight: number
  contextRowHeight: number
  footerHeight: number
  resultItemHeight: number
  maxVisibleResults: number
}

export const FALLBACK_SHELL_CONFIG: LauncherShellConfig = {
  shortcutLabel: "Cmd/Ctrl + Shift + Space",
  placeholder: "Type to prepare launcher search or AI routing.",
  baseHeight: 60,
  contextRowHeight: 40,
  footerHeight: 48,
  resultItemHeight: 56,
  maxVisibleResults: 4
}

export function getLauncherViewportHeight(
  resultCount: number,
  shellConfig: LauncherShellConfig = FALLBACK_SHELL_CONFIG
): number {
  const visibleCount = Math.min(Math.max(resultCount, 0), shellConfig.maxVisibleResults)
  if (visibleCount === 0) {
    return shellConfig.baseHeight
  }

  return (
    shellConfig.baseHeight +
    shellConfig.contextRowHeight +
    shellConfig.footerHeight +
    visibleCount * shellConfig.resultItemHeight
  )
}

export function getLauncherMaxViewportHeight(
  shellConfig: LauncherShellConfig = FALLBACK_SHELL_CONFIG
): number {
  return getLauncherViewportHeight(shellConfig.maxVisibleResults, shellConfig)
}
