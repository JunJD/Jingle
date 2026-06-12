import { pathToFileURL } from "node:url"
import type { NativeExtensionMainDefinition } from "@shared/native-extensions"
import type { ExtensionMainRef } from "./types"

const loadedMainModules = new Map<string, Promise<NativeExtensionMainDefinition>>()

export async function loadExtensionMainDefinition(
  mainRef: ExtensionMainRef
): Promise<NativeExtensionMainDefinition> {
  if (mainRef.kind === "in-memory") {
    return mainRef.definition
  }

  if (mainRef.trust !== "trusted") {
    throw new Error(
      `Installed extension "${mainRef.extensionName}" main module is privileged and requires trust "trusted".`
    )
  }

  const moduleKey = `${mainRef.extensionName}:${mainRef.version}:${mainRef.modulePath}`
  let modulePromise = loadedMainModules.get(moduleKey)
  if (!modulePromise) {
    modulePromise = import(pathToFileURL(mainRef.modulePath).href).then((module) =>
      readMainDefinitionModule(mainRef.extensionName, module)
    )
    loadedMainModules.set(moduleKey, modulePromise)
  }

  return modulePromise
}

function readMainDefinitionModule(
  extensionName: string,
  module: unknown
): NativeExtensionMainDefinition {
  if (!module || typeof module !== "object") {
    throw new Error(`Installed extension "${extensionName}" main module did not export an object`)
  }

  const exportsRecord = module as Record<string, unknown>
  const definition = exportsRecord.default ?? exportsRecord.main
  if (!definition || typeof definition !== "object") {
    throw new Error(
      `Installed extension "${extensionName}" main module must export a NativeExtensionMainDefinition as default`
    )
  }

  return definition as NativeExtensionMainDefinition
}
