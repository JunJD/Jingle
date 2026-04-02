import type { NativeExtensionDefinition } from "../shared/native-extensions"

const nativeExtensionModules = import.meta.glob("./*/index.ts", {
  eager: true
}) as Record<string, { default?: NativeExtensionDefinition }>

export const nativeExtensions = Object.values(nativeExtensionModules)
  .map((module) => {
    if (!module.default) {
      throw new Error("Native extension module must export a default definition")
    }

    return module.default
  })
  .sort((left, right) => left.manifest.title.localeCompare(right.manifest.title))
