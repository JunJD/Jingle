const NATIVE_EXTENSION_ASSET_PROTOCOL = "jingle-extension-asset"

export function getExtensionIconAssetSrc(params: {
  extensionName?: string
  icon?: string
}): string | null {
  const { extensionName, icon } = params
  if (!extensionName || !icon) {
    return null
  }

  const encodedIconPath = icon.split("/").map(encodeURIComponent).join("/")

  return `${NATIVE_EXTENSION_ASSET_PROTOCOL}://${encodeURIComponent(extensionName)}/${encodedIconPath}`
}
