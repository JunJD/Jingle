import type { ExtensionRuntimeLaunchProps } from "./extension-runtime-protocol"

export type LauncherResultKind = "application" | "file" | "directory" | "url" | "ai" | "history"

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
  historyGridItemHeight: number
  resultItemHeight: number
  sectionHeaderHeight: number
  maxVisibleResults: number
}

export type LauncherShellItemKind = LauncherResultKind | "plugin" | "suggestion"

export type LauncherResultPresentationIconName =
  | "bell"
  | "bookmark"
  | "check-circle"
  | "external-link"
  | "file-text"
  | "folder"
  | "github"
  | "globe"
  | "history"
  | "languages"
  | "reminders"
  | "search"
  | "sparkles"
  | "todo"
  | (string & {})

export type LauncherResultPresentationTone = "accent" | "brand" | "neutral"

export type LauncherResultPresentationIcon =
  | {
      name: LauncherResultPresentationIconName
      type: "glyph"
    }
  | {
      extensionName: string
      icon?: string
      iconName?: LauncherResultPresentationIconName
      type: "extension"
    }
  | {
      src: string
      type: "image"
    }

export interface LauncherResultPresentation {
  categoryLabel: string
  icon: LauncherResultPresentationIcon
  listActionLabel: string
  primaryActionLabel: string
  tone: LauncherResultPresentationTone
}

export interface LauncherCommandIntent {
  commandName?: string
  id: string
  kind: LauncherShellItemKind
  openOptions?: {
    initialAction?: "focus" | "submit"
    launchProps?: ExtensionRuntimeLaunchProps
    seedQuery?: string
  }
  presentation: LauncherResultPresentation
  priority?: number
  subtitle: string
  title: string
}

export interface LauncherCommandMatch {
  commandName?: string
  openOptions?: {
    initialAction?: "focus" | "submit"
    launchProps?: ExtensionRuntimeLaunchProps
    seedQuery?: string
  }
}

export interface LauncherCommandParams {
  altKey: boolean
  ctrlKey: boolean
  key: string
  metaKey: boolean
  query: string
  shiftKey: boolean
}

export type LauncherCommandSearchDefinition<TCopy = any> = {
  buildIntentItems?: (params: {
    copy: TCopy
    locale: import("./i18n").AppLocale
    query: string
  }) => LauncherCommandIntent[]
  resolveCommand?: (params: LauncherCommandParams) => LauncherCommandMatch | null
}

export interface LauncherIntentPresentationInput {
  categoryLabel: string
  icon: LauncherResultPresentationIcon
  listActionLabel?: string
  primaryActionLabel: string
  tone?: LauncherResultPresentationTone
}

export function createLauncherIntentPresentation(
  input: LauncherIntentPresentationInput
): LauncherResultPresentation {
  return {
    categoryLabel: input.categoryLabel,
    icon: input.icon,
    listActionLabel: input.listActionLabel ?? input.primaryActionLabel,
    primaryActionLabel: input.primaryActionLabel,
    tone: input.tone ?? "accent"
  }
}

export interface LauncherChromeMeasurement {
  footerHeight?: number
  headerHeight: number
}

export const LAUNCHER_LAYOUT_TOLERANCE_PX = 2

export const MAX_LAUNCHER_SEARCH_RESULTS = 20
export const LAUNCHER_SEARCH_TRANSACTION_TIMEOUT_MS = 700

export const LAUNCHER_HEADER_HEIGHT = 50
export const LAUNCHER_FOOTER_HEIGHT = 36
export const LAUNCHER_HISTORY_GRID_ITEM_HEIGHT = 72
export const LAUNCHER_RESULT_ITEM_HEIGHT = 44
export const LAUNCHER_SECTION_HEADER_HEIGHT = 24

export const FALLBACK_SHELL_CONFIG: LauncherShellConfig = {
  headerHeight: LAUNCHER_HEADER_HEIGHT,
  footerHeight: LAUNCHER_FOOTER_HEIGHT,
  historyGridItemHeight: LAUNCHER_HISTORY_GRID_ITEM_HEIGHT,
  resultItemHeight: LAUNCHER_RESULT_ITEM_HEIGHT,
  sectionHeaderHeight: LAUNCHER_SECTION_HEADER_HEIGHT,
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

export function getLauncherSectionedResultsHeight(
  itemCount: number,
  sectionHeaderCount: number,
  shellConfig: LauncherShellConfig = FALLBACK_SHELL_CONFIG
): number {
  return (
    getLauncherResultsHeight(itemCount, shellConfig) +
    Math.max(0, sectionHeaderCount) * shellConfig.sectionHeaderHeight
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
