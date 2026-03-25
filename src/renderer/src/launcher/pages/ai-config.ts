import {
  getLauncherViewportHeightForBody,
  type LauncherShellConfig
} from "../../../../shared/launcher"

const AI_PAGE_CONTENT_HEIGHT = 394

export function getAiPageViewportHeight(shellConfig: LauncherShellConfig): number {
  return getLauncherViewportHeightForBody(AI_PAGE_CONTENT_HEIGHT, shellConfig)
}
