import type { WebContents } from "electron"
import { ExternalLinksService } from "../external-links/service"

const externalLinksService = new ExternalLinksService()

interface ExternalWindowOpenHandlerOptions {
  openExternal?: (url: string) => Promise<void>
}

type RendererNavigationEvent = Electron.Event<
  Electron.WebContentsWillFrameNavigateEventParams | Electron.WebContentsWillRedirectEventParams
>

function isSameRendererDocument(currentUrl: string, targetUrl: string): boolean {
  if (currentUrl.length === 0) {
    return false
  }

  try {
    const current = new URL(currentUrl)
    const target = new URL(targetUrl)
    return (
      current.protocol === target.protocol &&
      current.host === target.host &&
      current.pathname === target.pathname &&
      current.search === target.search
    )
  } catch {
    return false
  }
}

export function installExternalWindowOpenHandler(
  webContents: WebContents,
  options: ExternalWindowOpenHandlerOptions = {}
): void {
  const openExternal = options.openExternal ?? ((url) => externalLinksService.openExternal(url))
  const handleExternalTarget = (url: string): void => {
    void openExternal(url).catch((error) => {
      console.warn("[windows] Blocked external navigation.", error)
    })
  }

  webContents.setWindowOpenHandler((details) => {
    handleExternalTarget(details.url)
    return { action: "deny" }
  })

  const handleNavigation = (event: RendererNavigationEvent): void => {
    if (event.isMainFrame && isSameRendererDocument(webContents.getURL(), event.url)) {
      return
    }

    event.preventDefault()
    if (event.isMainFrame) {
      handleExternalTarget(event.url)
    }
  }
  webContents.on("will-frame-navigate", handleNavigation)
  webContents.on("will-redirect", handleNavigation)
}
