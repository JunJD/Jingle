import { type IpcMain, shell } from "electron"
import { assertSafePublicHttpUrl } from "../services/web-tools/url-guard"

export function registerExternalLinkHandlers(ipcMain: IpcMain): void {
  ipcMain.handle("shell:openExternal", async (_event, url: string) => {
    const parsedUrl = await assertSafePublicHttpUrl(url)
    await shell.openExternal(parsedUrl.toString())
  })
}
