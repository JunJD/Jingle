import { shell } from "electron"
import { assertSafePublicHttpUrl } from "../services/web-tools/url-guard"

export class ExternalLinksService {
  async openExternal(url: string): Promise<void> {
    const parsedUrl = await assertSafePublicHttpUrl(url)
    await shell.openExternal(parsedUrl.toString())
  }
}
