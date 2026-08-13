import { createRequire } from "node:module"
import { pathToFileURL } from "node:url"
import type { NativeExtensionMainDefinition } from "@shared/native-extensions"
import type { ExtensionMainRef } from "./types"

const loadedMainModules = new Map<string, Promise<NativeExtensionMainDefinition>>()
const requireHostModule = createRequire(import.meta.url)

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

  const moduleKey = `${mainRef.extensionName}:${mainRef.version}:${mainRef.mainArtifactRevision}:${mainRef.modulePath}`
  let modulePromise = loadedMainModules.get(moduleKey)
  if (!modulePromise) {
    const source = Buffer.from(mainRef.moduleBytesBase64, "base64").toString("utf8")
    const moduleUrl = pathToFileURL(mainRef.modulePath).href
    const electron = requireHostModule("electron")
    const electronModuleUrl = createElectronModuleUrl(electron)
    const evaluatedSource = source
      .replaceAll("globalThis.__jingleExtensionMainModuleUrl", JSON.stringify(moduleUrl))
      .replace(/from\s+(["'])electron\1/g, `from ${JSON.stringify(electronModuleUrl)}`)
      .replace(/import\(\s*(["'])electron\1\s*\)/g, `import(${JSON.stringify(electronModuleUrl)})`)
    const host = globalThis as typeof globalThis & {
      __jingleElectron?: unknown
    }
    host.__jingleElectron = electron
    ;(globalThis as typeof globalThis & { __jingleElectron?: unknown }).__jingleElectron =
      requireHostModule("electron")
    modulePromise = import(
      `data:text/javascript;base64,${Buffer.from(evaluatedSource).toString("base64")}`
    ).then((module) => readMainDefinitionModule(mainRef.extensionName, module))
    loadedMainModules.set(moduleKey, modulePromise)
  }

  return modulePromise
}

function createElectronModuleUrl(electron: unknown): string {
  if (!electron || typeof electron !== "object") {
    const source = [
      "const electron = globalThis.__jingleElectron;",
      ...[
        "app",
        "shell",
        "clipboard",
        "BrowserWindow",
        "ipcMain",
        "dialog",
        "session",
        "Menu",
        "nativeImage",
        "screen",
        "systemPreferences",
        "protocol",
        "utilityProcess"
      ].map((name) => `export const ${name} = electron?.[${JSON.stringify(name)}];`),
      "export default electron;"
    ].join("\n")
    return `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
  }
  const exports = Object.keys(electron as Record<string, unknown>).filter((name) =>
    /^[$A-Z_a-z][$\w]*$/.test(name)
  )
  const source = [
    "const electron = globalThis.__jingleElectron;",
    ...exports.map((name) => `export const ${name} = electron[${JSON.stringify(name)}];`),
    "export default electron;"
  ].join("\n")
  return `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
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
