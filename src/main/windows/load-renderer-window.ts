import { BrowserWindow } from "electron"
import { join } from "path"

export type AppWindowKind = "main" | "launcher" | "settings"

const SPLASH_WINDOW_KINDS = new Set<AppWindowKind>(["main", "settings"])

export async function loadRendererWindow(
  browserWindow: BrowserWindow,
  windowKind: AppWindowKind
): Promise<void> {
  if (SPLASH_WINDOW_KINDS.has(windowKind)) {
    await browserWindow.loadFile(join(__dirname, "../../resources/splash.html"))
  }

  if (process.env["ELECTRON_RENDERER_URL"]) {
    const rendererUrl = new URL(process.env["ELECTRON_RENDERER_URL"])
    if (windowKind !== "main") {
      rendererUrl.searchParams.set("window", windowKind)
    }
    await browserWindow.loadURL(rendererUrl.toString())
    return
  }

  await browserWindow.loadFile(join(__dirname, "../renderer/index.html"), {
    query: windowKind === "main" ? undefined : { window: windowKind }
  })
}
