import { existsSync } from "node:fs"
import { extname, join, normalize, sep } from "node:path"
import { pathToFileURL } from "node:url"

export const NATIVE_EXTENSION_ASSET_PROTOCOL = "openwork-extension-asset"

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

function getExtensionAssetsRoots(): string[] {
  const packageRoots = [join(process.cwd(), "extensions"), join(process.cwd(), "src/extensions")]
  const builtResourcesRoot = join(__dirname, "../resources/extensions")

  return process.env.ELECTRON_RENDERER_URL
    ? [...packageRoots, builtResourcesRoot]
    : [builtResourcesRoot]
}

export function resolveNativeExtensionAssetPath(params: {
  extensionName: string
  path: string
}): string {
  const { extensionName, path } = params
  const normalizedPath = normalize(path)
  if (
    !extensionName.trim() ||
    !path.startsWith("assets/") ||
    normalizedPath.startsWith("..") ||
    normalizedPath.includes(`..${sep}`)
  ) {
    throw new Error(`Invalid native extension asset path: ${extensionName}/${path}`)
  }

  for (const assetsRoot of getExtensionAssetsRoots()) {
    const extensionRoot = join(assetsRoot, extensionName)
    const assetPath = join(extensionRoot, normalizedPath)
    if (existsSync(assetPath)) {
      return assetPath
    }
  }

  throw new Error(`Native extension asset not found: ${extensionName}/${path}`)
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
