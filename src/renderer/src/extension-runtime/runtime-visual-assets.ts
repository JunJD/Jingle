import { getExtensionIconAssetSrc } from "../extensions/extension-icon-assets"

export function resolveRuntimeVisualImageSource(params: {
  extensionName: string
  source: string
}): string {
  const { extensionName, source } = params
  if (isExternalRuntimeVisualImageSource(source)) {
    return source
  }

  const normalizedSource = source.replace(/^\.?\//, "")
  const assetPath = normalizedSource.startsWith("assets/")
    ? normalizedSource
    : `assets/${normalizedSource}`

  return getExtensionIconAssetSrc({ extensionName, icon: assetPath }) ?? source
}

function isExternalRuntimeVisualImageSource(source: string): boolean {
  return /^[a-z][a-z\d+.-]*:/i.test(source) || source.startsWith("/") || source.startsWith("#")
}
