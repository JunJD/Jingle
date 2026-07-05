import { pathToFileURL } from "node:url"
import { nativeExtensionRuntimePackages } from "@extensions/runtime-packages"
import type { ExtensionRuntimeLaunchPackageRef } from "@shared/extension-runtime-protocol"
import type {
  NativeExtensionRuntimeCommandDefinition,
  NativeExtensionRuntimePackage
} from "@jingle/extension-api"

const builtInRuntimePackagesByExtensionName = new Map(
  nativeExtensionRuntimePackages.map((runtimePackage) => [
    runtimePackage.extensionName,
    runtimePackage
  ])
)

const loadedRuntimeModules = new Map<string, Promise<NativeExtensionRuntimePackage>>()

export async function loadNativeExtensionRuntimeCommand(
  runtimeRef: ExtensionRuntimeLaunchPackageRef,
  params: {
    commandName: string
    extensionName: string
  }
): Promise<NativeExtensionRuntimeCommandDefinition> {
  if (runtimeRef.extensionName !== params.extensionName) {
    throw new Error(
      `Extension runtime ref "${runtimeRef.extensionName}" cannot launch "${params.extensionName}:${params.commandName}".`
    )
  }

  const runtimePackage = await loadNativeExtensionRuntimePackage(runtimeRef)
  const command = runtimePackage.commands[params.commandName]
  if (!command) {
    throw new Error(
      `Extension runtime command "${params.extensionName}:${params.commandName}" is not registered.`
    )
  }

  return {
    ...command,
    commandName: params.commandName,
    extensionName: params.extensionName
  }
}

async function loadNativeExtensionRuntimePackage(
  runtimeRef: ExtensionRuntimeLaunchPackageRef
): Promise<NativeExtensionRuntimePackage> {
  if (runtimeRef.kind === "built-in") {
    const runtimePackage = builtInRuntimePackagesByExtensionName.get(runtimeRef.extensionName)
    if (!runtimePackage) {
      throw new Error(`Built-in extension runtime "${runtimeRef.extensionName}" is not registered.`)
    }

    return runtimePackage
  }

  const moduleKey = `${runtimeRef.extensionName}:${runtimeRef.version}:${runtimeRef.modulePath}`
  let modulePromise = loadedRuntimeModules.get(moduleKey)
  if (!modulePromise) {
    modulePromise = import(pathToFileURL(runtimeRef.modulePath).href).then((module) =>
      readRuntimePackageModule(runtimeRef.extensionName, module)
    )
    loadedRuntimeModules.set(moduleKey, modulePromise)
  }

  return modulePromise
}

function readRuntimePackageModule(
  extensionName: string,
  module: unknown
): NativeExtensionRuntimePackage {
  if (!module || typeof module !== "object") {
    throw new Error(`Installed extension "${extensionName}" runtime module did not export an object`)
  }

  const exportsRecord = module as Record<string, unknown>
  const runtimePackage = exportsRecord.default ?? exportsRecord.runtime
  if (!runtimePackage || typeof runtimePackage !== "object") {
    throw new Error(
      `Installed extension "${extensionName}" runtime module must export a NativeExtensionRuntimePackage as default`
    )
  }

  const candidate = runtimePackage as NativeExtensionRuntimePackage
  if (candidate.extensionName !== extensionName) {
    throw new Error(
      `Installed extension runtime "${candidate.extensionName}" does not match "${extensionName}".`
    )
  }

  return candidate
}
