import { BrowserWindow } from "electron"
import { join } from "path"
import { PINNED_AI_SESSION_WINDOW_KIND } from "@shared/ai-session-window"

export type AppWindowKind = "main" | "launcher" | "settings" | typeof PINNED_AI_SESSION_WINDOW_KIND

const SPLASH_WINDOW_KINDS = new Set<AppWindowKind>(["main"])

export async function loadRendererWindow(
  browserWindow: BrowserWindow,
  windowKind: AppWindowKind,
  query?: Record<string, string>
): Promise<void> {
  if (SPLASH_WINDOW_KINDS.has(windowKind)) {
    await browserWindow.loadFile(join(__dirname, "../../resources/splash.html"))
  }

  if (process.env["ELECTRON_RENDERER_URL"]) {
    const rendererUrl = new URL(process.env["ELECTRON_RENDERER_URL"])
    if (windowKind !== "main") {
      rendererUrl.searchParams.set("window", windowKind)
    }
    for (const [key, value] of Object.entries(query ?? {})) {
      rendererUrl.searchParams.set(key, value)
    }
    await browserWindow.loadURL(rendererUrl.toString())
    return
  }

  const rendererQuery = {
    ...(windowKind === "main" ? {} : { window: windowKind }),
    ...(query ?? {})
  }

  await browserWindow.loadFile(join(__dirname, "../renderer/index.html"), {
    query: Object.keys(rendererQuery).length > 0 ? rendererQuery : undefined
  })
}
