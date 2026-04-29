import { getLauncherViewportHeightForBody, type LauncherShellConfig } from "@shared/launcher"

const AI_PAGE_CONTENT_HEIGHT = 468
const AI_HEADER_HEIGHT = 48
const AI_FOOTER_HEIGHT = 36

export function getAiShellConfig(shellConfig: LauncherShellConfig): LauncherShellConfig {
  return {
    ...shellConfig,
    footerHeight: AI_FOOTER_HEIGHT,
    headerHeight: AI_HEADER_HEIGHT
  }
}

export function getAiPageViewportHeight(shellConfig: LauncherShellConfig): number {
  return getLauncherViewportHeightForBody(AI_PAGE_CONTENT_HEIGHT, getAiShellConfig(shellConfig))
}
