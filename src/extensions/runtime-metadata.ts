import type { NativeExtensionRuntimePackageMetadata } from "@openwork/extension-api"
import { nativeExtensionRuntimeMetadataPackages } from "./runtime-metadata-packages"

export const nativeExtensionRuntimeMetadata = new Map<string, NativeExtensionRuntimePackageMetadata>(
  nativeExtensionRuntimeMetadataPackages.map((metadata) => [metadata.extensionName, metadata])
)
