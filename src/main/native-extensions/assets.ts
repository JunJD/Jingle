import { extname } from "node:path"
import { pathToFileURL } from "node:url"
import { getDefaultExtensionRegistryService } from "../extensions/registry/default-registry"

export const NATIVE_EXTENSION_ASSET_PROTOCOL = "jingle-extension-asset"

function getMimeType(filePath: string): string {
  switch (extname(filePath).toLowerCase()) {
    case ".png":
      return "image/png"
    case ".svg":
      return "image/svg+xml"
    case ".jpg":
    case ".jpeg":
      return "image/jpeg"
    case ".webp":
      return "image/webp"
    default:
      return "application/octet-stream"
  }
}

export function resolveNativeExtensionAssetPath(params: {
  extensionName: string
  path: string
}): string {
  const { extensionName, path } = params
  if (!extensionName.trim() || !path.startsWith("assets/")) {
    throw new Error(`Invalid native extension asset path: ${extensionName}/${path}`)
  }

  return getDefaultExtensionRegistryService().resolveAsset(extensionName, path)
}

export function createNativeExtensionAssetUrl(params: {
  extensionName: string
  path: string
}): string {
  return `${NATIVE_EXTENSION_ASSET_PROTOCOL}://${encodeURIComponent(params.extensionName)}/${params.path
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`
}

export function resolveNativeExtensionAssetFileUrl(params: {
  extensionName: string
  path: string
}): string {
  return pathToFileURL(resolveNativeExtensionAssetPath(params)).href
}

export function getNativeExtensionAssetMimeType(params: {
  extensionName: string
  path: string
}): string {
  return getMimeType(resolveNativeExtensionAssetPath(params))
}
