import type { NativeExtensionRuntimePackageMetadata } from "./runtime-metadata-contract"
import { nativeExtensionRuntimeMetadataPackages } from "./runtime-metadata-packages"

export const nativeExtensionRuntimeMetadata = new Map<string, NativeExtensionRuntimePackageMetadata>(
  nativeExtensionRuntimeMetadataPackages.map((metadata) => [metadata.extensionName, metadata])
)
