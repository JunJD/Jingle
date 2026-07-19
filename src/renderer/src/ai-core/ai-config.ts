import { getLauncherViewportHeightForBody, type LauncherShellConfig } from "@shared/launcher"
import { DURABLE_WINDOW_HEADER_HEIGHT } from "@shared/durable-window"

const AI_PAGE_CONTENT_HEIGHT = 468
export const AI_FOOTER_HEIGHT = 64

export function getAiShellConfig(
  shellConfig: LauncherShellConfig,
  options: {
    footerHeight?: number
  } = {}
): LauncherShellConfig {
  const { footerHeight = AI_FOOTER_HEIGHT } = options

  return {
    ...shellConfig,
    footerHeight,
    headerHeight: DURABLE_WINDOW_HEADER_HEIGHT
  }
}

export function getAiPageViewportHeight(shellConfig: LauncherShellConfig): number {
  return getLauncherViewportHeightForBody(AI_PAGE_CONTENT_HEIGHT, getAiShellConfig(shellConfig))
}
