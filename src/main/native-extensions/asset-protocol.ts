import { net, protocol } from "electron"
import {
  getNativeExtensionAssetMimeType,
  NATIVE_EXTENSION_ASSET_PROTOCOL,
  resolveNativeExtensionAssetFileUrl
} from "./assets"

export function registerNativeExtensionAssetProtocol(): void {
  protocol.handle(NATIVE_EXTENSION_ASSET_PROTOCOL, (request) => {
    const url = new URL(request.url)
    const extensionName = decodeURIComponent(url.hostname)
    const assetPath = decodeURIComponent(url.pathname).replace(/^\/+/, "")
    const fileUrl = resolveNativeExtensionAssetFileUrl({
      extensionName,
      path: assetPath
    })

    return net.fetch(fileUrl).then(
      (response) =>
        new Response(response.body, {
          headers: {
            "content-type": getNativeExtensionAssetMimeType({
              extensionName,
              path: assetPath
            })
          },
          status: response.status
        })
    )
  })
}
