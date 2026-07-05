import type { WebContents } from "electron"
import { ExternalLinksService } from "../external-links/service"

const externalLinksService = new ExternalLinksService()

export function installExternalWindowOpenHandler(webContents: WebContents): void {
  webContents.setWindowOpenHandler((details) => {
    void externalLinksService.openExternal(details.url).catch((error) => {
      console.warn("[windows] Blocked external window open.", error)
    })
    return { action: "deny" }
  })
}
