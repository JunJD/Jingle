import { lazy } from "react"

export const LazyLauncherAiPage = lazy(async () => {
  const module = await import("./LauncherAiPage")
  return { default: module.LauncherAiPage }
})
