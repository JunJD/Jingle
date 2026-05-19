import { getLauncherViewportHeightForBody, type LauncherShellConfig } from "@shared/launcher"

const AI_PAGE_CONTENT_HEIGHT = 468
const AI_HEADER_HEIGHT = 48
const AI_FOOTER_HEIGHT = 64
const AI_EXPANDED_FOOTER_HEIGHT = 196

export function getAiShellConfig(
  shellConfig: LauncherShellConfig,
  options: {
    footerExpanded?: boolean
  } = {}
): LauncherShellConfig {
  const { footerExpanded = false } = options

  return {
    ...shellConfig,
    footerHeight: footerExpanded ? AI_EXPANDED_FOOTER_HEIGHT : AI_FOOTER_HEIGHT,
    headerHeight: AI_HEADER_HEIGHT
  }
}

export function getAiPageViewportHeight(shellConfig: LauncherShellConfig): number {
  return getLauncherViewportHeightForBody(AI_PAGE_CONTENT_HEIGHT, getAiShellConfig(shellConfig))
}
