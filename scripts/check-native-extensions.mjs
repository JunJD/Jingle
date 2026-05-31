import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { validateNativeExtensionPackageBoundaries } from "./native-extension-package-boundaries.mjs"

async function main() {
  const [
    { nativeExtensionManifests },
    { nativeExtensionMainDefinitions },
    { nativeExtensionRuntimePackages },
    { nativeExtensionRuntimeMetadataPackages },
    { validateNativeExtensionRegistry }
  ] = await Promise.all([
    import(pathToFileURL(resolve("src/extensions/index.ts")).href),
    import(pathToFileURL(resolve("src/extensions/main.ts")).href),
    import(pathToFileURL(resolve("src/extensions/runtime-packages.ts")).href),
    import(pathToFileURL(resolve("src/extensions/runtime-metadata-packages.ts")).href),
    import(pathToFileURL(resolve("src/main/native-extensions/validation.ts")).href)
  ])

  const result = validateNativeExtensionRegistry({
    assetRoots: [resolve("extensions"), resolve("src/extensions")],
    mainDefinitions: nativeExtensionMainDefinitions,
    manifests: nativeExtensionManifests,
    runtimeMetadataPackages: nativeExtensionRuntimeMetadataPackages,
    runtimePackages: nativeExtensionRuntimePackages
  })

  const packageBoundaryResult = validateNativeExtensionPackageBoundaries()
  const errors = [...result.errors, ...packageBoundaryResult.errors]

  if (errors.length > 0) {
    console.error("Native extension validation failed:")
    for (const error of errors) {
      console.error(`- ${error}`)
    }
    process.exitCode = 1
    return
  }

  console.log(`Native extension validation passed (${nativeExtensionManifests.length} extensions).`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
