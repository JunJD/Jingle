import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import type {
  ExternalExtensionBundleResult,
  ExternalExtensionCommandArgumentDefinition,
  ExternalExtensionCommandInfo,
  ExternalExtensionCommandSettingsSchema,
  ExternalExtensionPreferenceSchema,
  InstalledExternalExtensionSettingsSchema
} from "../../../shared/external-extensions"
import {
  getExternalExtensionCustomRoots,
  setExternalExtensionCustomRoots
} from "../../external-extension-settings-store"

type RaycastPlatform = "macOS" | "Windows" | "Linux"

interface InstalledExtensionSource {
  extName: string
  extPath: string
  sourceRoot: string
}

const nodeBuiltins = [
  "assert",
  "buffer",
  "child_process",
  "cluster",
  "crypto",
  "dgram",
  "dns",
  "events",
  "fs",
  "fs/promises",
  "http",
  "http2",
  "https",
  "module",
  "net",
  "os",
  "path",
  "perf_hooks",
  "process",
  "querystring",
  "readline",
  "stream",
  "stream/promises",
  "string_decoder",
  "timers",
  "timers/promises",
  "tls",
  "tty",
  "url",
  "util",
  "v8",
  "vm",
  "worker_threads",
  "zlib",
  "async_hooks",
  "node:assert",
  "node:buffer",
  "node:child_process",
  "node:crypto",
  "node:events",
  "node:fs",
  "node:fs/promises",
  "node:http",
  "node:https",
  "node:module",
  "node:net",
  "node:os",
  "node:path",
  "node:process",
  "node:querystring",
  "node:stream",
  "node:timers",
  "node:timers/promises",
  "node:url",
  "node:util",
  "node:vm",
  "node:worker_threads",
  "node:zlib",
  "node:async_hooks"
]

interface ElectronAppLike {
  getAppPath: () => string
  getPath: (name: "userData") => string
  isReady?: () => boolean
}

function getElectronApp(): ElectronAppLike | null {
  try {
    return require("electron").app as ElectronAppLike
  } catch {
    return null
  }
}

function getOpenworkUserDataPath(): string {
  const electronApp = getElectronApp()

  try {
    if (electronApp && typeof electronApp.isReady === "function" && electronApp.isReady()) {
      return electronApp.getPath("userData")
    }
  } catch {
    // Fall back to a stable local path when Electron app paths are unavailable.
  }

  return path.join(os.homedir(), ".openwork")
}

function getOpenworkAppPath(): string {
  try {
    const electronApp = getElectronApp()
    if (electronApp) {
      return electronApp.getAppPath()
    }
  } catch {
    // Fall through to cwd below.
  }

  return process.cwd()
}

function requireEsbuild(): any {
  try {
    const mainPath = require.resolve("esbuild")
    if (mainPath.includes("app.asar")) {
      const unpackedPath = mainPath.replace("app.asar", "app.asar.unpacked")
      if (fs.existsSync(unpackedPath)) {
        return require(unpackedPath)
      }
    }

    return require("esbuild")
  } catch {
    return require("esbuild")
  }
}

function normalizePlatform(value: unknown): RaycastPlatform | null {
  if (typeof value !== "string") {
    return null
  }

  const normalized = value.trim().toLowerCase()
  if (!normalized) {
    return null
  }

  if (normalized === "macos" || normalized === "darwin" || normalized === "mac") {
    return "macOS"
  }

  if (normalized === "windows" || normalized === "win32" || normalized === "win") {
    return "Windows"
  }

  if (normalized === "linux") {
    return "Linux"
  }

  return null
}

function getCurrentRaycastPlatform(): RaycastPlatform {
  if (process.platform === "win32") {
    return "Windows"
  }

  if (process.platform === "linux") {
    return "Linux"
  }

  return "macOS"
}

function getManifestPlatforms(manifest: unknown): RaycastPlatform[] {
  if (!manifest || typeof manifest !== "object") {
    return []
  }

  const platforms = (manifest as { platforms?: unknown }).platforms
  if (!Array.isArray(platforms)) {
    return []
  }

  const supported = new Set<RaycastPlatform>()
  for (const raw of platforms) {
    const normalized = normalizePlatform(raw)
    if (normalized) {
      supported.add(normalized)
    }
  }

  return [...supported]
}

function isManifestPlatformCompatible(manifest: unknown): boolean {
  const supported = getManifestPlatforms(manifest)
  if (supported.length === 0) {
    return true
  }

  return supported.includes(getCurrentRaycastPlatform())
}

function isCommandPlatformCompatible(command: unknown): boolean {
  if (!command || typeof command !== "object") {
    return false
  }

  if (!Object.prototype.hasOwnProperty.call(command, "platforms")) {
    return true
  }

  return isManifestPlatformCompatible(command)
}

function getManagedExtensionsDir(): string {
  const dir = path.join(getOpenworkUserDataPath(), "extensions")
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }

  return dir
}

function getBuildDir(extPath: string): string {
  const dir = path.join(extPath, ".ow-build")
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }

  return dir
}

function expandHome(inputPath: string): string {
  const raw = String(inputPath || "").trim()
  if (!raw) {
    return ""
  }

  if (raw.startsWith("~/")) {
    return path.join(os.homedir(), raw.slice(2))
  }

  return raw
}

function normalizeFsPath(inputPath: string): string {
  return path.resolve(expandHome(inputPath))
}

function normalizeExtensionName(name: string): string {
  const raw = String(name || "").trim()
  if (!raw) {
    return ""
  }

  return raw.replace(/^@/, "").replace(/[\\/]/g, "-")
}

function getWorkspaceReferenceExtensionRoots(): string[] {
  const appPath = getOpenworkAppPath()
  const candidates = [
    path.join(appPath, "raycast", "examples"),
    path.join(appPath, "raycast", "extensions"),
    path.join(process.cwd(), "raycast", "examples"),
    path.join(process.cwd(), "raycast", "extensions")
  ]

  return candidates.filter((candidate, index) => {
    return candidates.indexOf(candidate) === index && fs.existsSync(candidate)
  })
}

export function listConfiguredExtensionRoots(): string[] {
  const envPaths = String(process.env.OPENWORK_EXTENSION_PATHS || "")
    .split(path.delimiter)
    .map((value) => value.trim())
    .filter(Boolean)

  const unique = new Set<string>()
  for (const root of [
    getManagedExtensionsDir(),
    ...getWorkspaceReferenceExtensionRoots(),
    ...getExternalExtensionCustomRoots(),
    ...envPaths
  ]) {
    const normalized = normalizeFsPath(root)
    if (!normalized) {
      continue
    }

    unique.add(normalized)
  }

  return [...unique]
}

export function getConfiguredExternalExtensionCustomRoots(): string[] {
  return getExternalExtensionCustomRoots()
}

export function setConfiguredExternalExtensionCustomRoots(nextRoots: string[]): string[] {
  return setExternalExtensionCustomRoots(nextRoots)
}

function collectInstalledExtensions(): InstalledExtensionSource[] {
  const results: InstalledExtensionSource[] = []
  const seen = new Set<string>()

  const addIfValid = (extPath: string, sourceRoot: string, fallbackName: string): void => {
    const pkgPath = path.join(extPath, "package.json")
    if (!fs.existsSync(pkgPath)) {
      return
    }

    try {
      if (!fs.statSync(extPath).isDirectory()) {
        return
      }
    } catch {
      return
    }

    const extName = normalizeExtensionName(fallbackName)
    if (!extName) {
      return
    }

    const dedupeKey = extName.toLowerCase()
    if (seen.has(dedupeKey)) {
      return
    }

    seen.add(dedupeKey)
    results.push({ extName, extPath, sourceRoot })
  }

  for (const sourceRoot of listConfiguredExtensionRoots()) {
    if (!fs.existsSync(sourceRoot)) {
      continue
    }

    const sourceRootPkg = path.join(sourceRoot, "package.json")
    if (fs.existsSync(sourceRootPkg)) {
      addIfValid(sourceRoot, sourceRoot, path.basename(sourceRoot))
      continue
    }

    let entries: string[] = []
    try {
      entries = fs.readdirSync(sourceRoot)
    } catch {
      continue
    }

    for (const entry of entries) {
      addIfValid(path.join(sourceRoot, entry), sourceRoot, entry)
    }
  }

  return results
}

function resolveInstalledExtensionPath(extName: string): string | null {
  const normalized = normalizeExtensionName(extName)
  if (!normalized) {
    return null
  }

  const match = collectInstalledExtensions().find((entry) => entry.extName === normalized)
  return match?.extPath || null
}

function getExtensionIconDataUrl(extPath: string, iconFile: string): string | undefined {
  const candidates = [path.join(extPath, "assets", iconFile), path.join(extPath, iconFile)]

  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) {
      continue
    }

    try {
      const ext = path.extname(candidate).toLowerCase()
      const data = fs.readFileSync(candidate)
      if (data.length < 50) {
        continue
      }

      const mime =
        ext === ".svg"
          ? "image/svg+xml"
          : ext === ".jpg" || ext === ".jpeg"
            ? "image/jpeg"
            : "image/png"

      return `data:${mime};base64,${data.toString("base64")}`
    } catch {
      continue
    }
  }

  return undefined
}

function getExtensionOwnerLabel(pkg: Record<string, unknown>): string {
  const rawOwner = pkg.owner ?? pkg.author ?? ""
  if (
    rawOwner &&
    typeof rawOwner === "object" &&
    "name" in rawOwner &&
    typeof rawOwner.name === "string"
  ) {
    return rawOwner.name
  }

  return String(rawOwner || "")
}

function resolvePlatformDefault(value: unknown): unknown {
  const platformKey = process.platform === "win32" ? "Windows" : "macOS"
  if (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (Object.prototype.hasOwnProperty.call(value, "macOS") ||
      Object.prototype.hasOwnProperty.call(value, "Windows"))
  ) {
    const platformValues = value as Record<string, unknown>
    if (Object.prototype.hasOwnProperty.call(platformValues, platformKey)) {
      return platformValues[platformKey]
    }

    return platformValues.macOS ?? platformValues.Windows
  }

  return value
}

function normalizePreferenceSchema(
  pref: unknown,
  scope: "extension" | "command"
): ExternalExtensionPreferenceSchema | null {
  if (!pref || typeof pref !== "object") {
    return null
  }

  const input = pref as Record<string, unknown>
  if (typeof input.name !== "string" || !input.name) {
    return null
  }

  return {
    scope,
    name: input.name,
    title: typeof input.title === "string" ? input.title : undefined,
    label: typeof input.label === "string" ? input.label : undefined,
    description: typeof input.description === "string" ? input.description : undefined,
    placeholder: typeof input.placeholder === "string" ? input.placeholder : undefined,
    required: Boolean(input.required),
    type: typeof input.type === "string" ? input.type : undefined,
    default: resolvePlatformDefault(input.default),
    data: Array.isArray(input.data)
      ? input.data
          .filter(
            (item): item is Record<string, unknown> => Boolean(item) && typeof item === "object"
          )
          .map((item) => ({
            title: typeof item.title === "string" ? item.title : undefined,
            value: typeof item.value === "string" ? item.value : undefined
          }))
      : undefined
  }
}

function getInstallableRuntimeDeps(pkg: Record<string, unknown>): string[] {
  const deps = {
    ...((pkg.dependencies as Record<string, unknown> | undefined) ?? {}),
    ...((pkg.optionalDependencies as Record<string, unknown> | undefined) ?? {})
  }

  return Object.entries(deps)
    .filter(([name]) => !name.startsWith("@raycast/"))
    .map(([name, version]) => `${name}@${String(version || "").trim()}`)
    .filter((value) => {
      const atIndex = value.lastIndexOf("@")
      return atIndex > 0 && atIndex < value.length - 1
    })
}

function extensionRequiresNodeModules(pkg: Record<string, unknown>): boolean {
  return getInstallableRuntimeDeps(pkg).length > 0
}

function getWorkspaceNodeModulesDir(): string | null {
  const candidate = path.join(process.cwd(), "node_modules")
  return fs.existsSync(candidate) ? candidate : null
}

function getRuntimeDependencyNames(pkg: Record<string, unknown>): string[] {
  const deps = {
    ...((pkg.dependencies as Record<string, unknown> | undefined) ?? {}),
    ...((pkg.optionalDependencies as Record<string, unknown> | undefined) ?? {})
  }

  return Object.keys(deps).filter((name) => !name.startsWith("@raycast/"))
}

function getExtensionNodePaths(extPath: string, pkg: Record<string, unknown>): string[] {
  const extensionNodeModulesDir = path.join(extPath, "node_modules")
  if (fs.existsSync(extensionNodeModulesDir)) {
    return [extensionNodeModulesDir]
  }

  const workspaceNodeModulesDir = getWorkspaceNodeModulesDir()
  if (!workspaceNodeModulesDir) {
    return []
  }

  const dependencyNames = getRuntimeDependencyNames(pkg)
  if (dependencyNames.length === 0) {
    return [workspaceNodeModulesDir]
  }

  const hasAllWorkspaceDependencies = dependencyNames.every((dependencyName) => {
    return fs.existsSync(path.join(workspaceNodeModulesDir, dependencyName))
  })

  return hasAllWorkspaceDependencies ? [workspaceNodeModulesDir] : []
}

function getExtensionCompilerOptions(extPath: string): Record<string, unknown> {
  const tsconfigPath = path.join(extPath, "tsconfig.json")
  if (!fs.existsSync(tsconfigPath)) {
    return {}
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(tsconfigPath, "utf-8")) as {
      compilerOptions?: Record<string, unknown>
    }
    const compilerOptions = parsed.compilerOptions ?? {}

    const options: Record<string, unknown> = {}
    if (typeof compilerOptions.baseUrl === "string" && compilerOptions.baseUrl.trim()) {
      options.baseUrl = compilerOptions.baseUrl
    }

    if (
      compilerOptions.paths &&
      typeof compilerOptions.paths === "object" &&
      !Array.isArray(compilerOptions.paths)
    ) {
      options.paths = compilerOptions.paths
      if (!options.baseUrl) {
        options.baseUrl = "."
      }
    }

    if (typeof compilerOptions.jsx === "string" && compilerOptions.jsx.trim()) {
      options.jsx = compilerOptions.jsx
    }

    if (
      typeof compilerOptions.jsxImportSource === "string" &&
      compilerOptions.jsxImportSource.trim()
    ) {
      options.jsxImportSource = compilerOptions.jsxImportSource
    }

    return options
  } catch (error) {
    console.warn(
      `Failed to parse tsconfig for ${path.basename(extPath)}:`,
      error instanceof Error ? error.message : String(error)
    )
    return {}
  }
}

function getEsbuildTsconfigRaw(extPath: string): string {
  const extensionCompilerOptions = getExtensionCompilerOptions(extPath)

  return JSON.stringify({
    compilerOptions: {
      target: "ES2020",
      jsx: "react-jsx",
      jsxImportSource: "react",
      strict: false,
      esModuleInterop: true,
      moduleResolution: "node",
      ...extensionCompilerOptions
    }
  })
}

function resolveEntryFile(extPath: string, command: Record<string, unknown>): string | null {
  const commandName = String(command.name || "").trim()
  if (!commandName) {
    return null
  }

  const srcDir = path.join(extPath, "src")
  const validExt = /\.(tsx?|jsx?)$/i
  const explicitEntry =
    typeof command.path === "string"
      ? command.path
      : typeof command.entrypoint === "string"
        ? command.entrypoint
        : typeof command.entry === "string"
          ? command.entry
          : typeof command.file === "string"
            ? command.file
            : typeof command.source === "string"
              ? command.source
              : ""

  const candidates = [
    explicitEntry ? path.join(extPath, explicitEntry) : "",
    path.join(srcDir, `${commandName}.tsx`),
    path.join(srcDir, `${commandName}.ts`),
    path.join(srcDir, `${commandName}.jsx`),
    path.join(srcDir, `${commandName}.js`),
    path.join(srcDir, commandName, "index.tsx"),
    path.join(srcDir, commandName, "index.ts"),
    path.join(srcDir, commandName, "index.jsx"),
    path.join(srcDir, commandName, "index.js"),
    path.join(srcDir, "commands", `${commandName}.tsx`),
    path.join(srcDir, "commands", `${commandName}.ts`),
    path.join(srcDir, "commands", `${commandName}.jsx`),
    path.join(srcDir, "commands", `${commandName}.js`)
  ].filter(Boolean)

  const found = candidates.find((candidate) => fs.existsSync(candidate))
  if (found) {
    return found
  }

  if (!fs.existsSync(srcDir)) {
    return null
  }

  const stack = [srcDir]
  const normalized = commandName.toLowerCase()
  while (stack.length > 0) {
    const dir = stack.pop()
    if (!dir) {
      continue
    }

    let entries: string[] = []
    try {
      entries = fs.readdirSync(dir)
    } catch {
      continue
    }

    for (const entry of entries) {
      const full = path.join(dir, entry)
      let stat: fs.Stats
      try {
        stat = fs.statSync(full)
      } catch {
        continue
      }

      if (stat.isDirectory()) {
        stack.push(full)
        continue
      }

      if (!validExt.test(entry)) {
        continue
      }

      const base = path.basename(entry, path.extname(entry)).toLowerCase()
      if (base === normalized) {
        return full
      }
    }
  }

  return null
}

function toCommandArgumentDefinitions(
  command: Record<string, unknown> | undefined
): ExternalExtensionCommandArgumentDefinition[] {
  if (!command || !Array.isArray(command.arguments)) {
    return []
  }

  return command.arguments
    .filter((arg): arg is Record<string, unknown> => Boolean(arg) && typeof arg === "object")
    .filter((arg) => typeof arg.name === "string" && arg.name.length > 0)
    .map((arg) => ({
      name: arg.name as string,
      required: Boolean(arg.required),
      type: typeof arg.type === "string" ? arg.type : undefined,
      placeholder: typeof arg.placeholder === "string" ? arg.placeholder : undefined,
      title: typeof arg.title === "string" ? arg.title : undefined,
      data: Array.isArray(arg.data)
        ? arg.data
            .filter(
              (item): item is Record<string, unknown> => Boolean(item) && typeof item === "object"
            )
            .map((item) => ({
              title: typeof item.title === "string" ? item.title : undefined,
              value: typeof item.value === "string" ? item.value : undefined
            }))
        : undefined
    }))
}

function parsePreferences(
  pkg: Record<string, unknown>,
  commandName: string
): {
  commandPrefs: Record<string, unknown>
  definitions: ExternalExtensionPreferenceSchema[]
  extensionPrefs: Record<string, unknown>
} {
  const extensionPrefs: Record<string, unknown> = {}
  const commandPrefs: Record<string, unknown> = {}
  const definitions: ExternalExtensionPreferenceSchema[] = []

  const extensionPreferences = Array.isArray(pkg.preferences) ? pkg.preferences : []
  for (const pref of extensionPreferences) {
    const normalized = normalizePreferenceSchema(pref, "extension")
    if (!normalized) {
      continue
    }

    definitions.push(normalized)
    if (normalized.default !== undefined) {
      extensionPrefs[normalized.name] = normalized.default
    } else if (normalized.type === "checkbox") {
      extensionPrefs[normalized.name] = false
    } else if (normalized.type === "textfield" || normalized.type === "password") {
      extensionPrefs[normalized.name] = ""
    } else if (normalized.type === "dropdown") {
      extensionPrefs[normalized.name] = normalized.data?.[0]?.value ?? ""
    }
  }

  const commands = Array.isArray(pkg.commands) ? pkg.commands : []
  const command = commands.find((item) => {
    return (
      item && typeof item === "object" && (item as Record<string, unknown>).name === commandName
    )
  }) as Record<string, unknown> | undefined

  const commandPreferences = Array.isArray(command?.preferences) ? command.preferences : []
  for (const pref of commandPreferences) {
    const normalized = normalizePreferenceSchema(pref, "command")
    if (!normalized) {
      continue
    }

    definitions.push(normalized)
    if (normalized.default !== undefined) {
      commandPrefs[normalized.name] = normalized.default
    } else if (normalized.type === "checkbox") {
      commandPrefs[normalized.name] = false
    } else if (normalized.type === "textfield" || normalized.type === "password") {
      commandPrefs[normalized.name] = ""
    } else if (normalized.type === "dropdown") {
      commandPrefs[normalized.name] = normalized.data?.[0]?.value ?? ""
    }
  }

  return { commandPrefs, definitions, extensionPrefs }
}

function readExtensionPackage(extPath: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(extPath, "package.json"), "utf-8")) as Record<
    string,
    unknown
  >
}

export function listExternalExtensionCommands(): ExternalExtensionCommandInfo[] {
  const results: ExternalExtensionCommandInfo[] = []

  for (const source of collectInstalledExtensions()) {
    try {
      const pkg = readExtensionPackage(source.extPath)
      if (!isManifestPlatformCompatible(pkg)) {
        continue
      }

      const iconDataUrl = getExtensionIconDataUrl(
        source.extPath,
        typeof pkg.icon === "string" ? pkg.icon : "icon.png"
      )
      const commands = Array.isArray(pkg.commands) ? pkg.commands : []

      for (const command of commands) {
        if (!command || typeof command !== "object") {
          continue
        }

        const commandRecord = command as Record<string, unknown>
        if (typeof commandRecord.name !== "string" || !commandRecord.name) {
          continue
        }

        if (!isCommandPlatformCompatible(commandRecord)) {
          continue
        }

        results.push({
          commandArgumentDefinitions: toCommandArgumentDefinitions(commandRecord),
          commandName: commandRecord.name,
          description:
            typeof commandRecord.description === "string" ? commandRecord.description : "",
          disabledByDefault: Boolean(commandRecord.disabledByDefault),
          extensionName: source.extName,
          extensionTitle: typeof pkg.title === "string" && pkg.title ? pkg.title : source.extName,
          iconDataUrl,
          id: `ext-${source.extName}-${commandRecord.name}`,
          interval: typeof commandRecord.interval === "string" ? commandRecord.interval : undefined,
          keywords: [
            source.extName,
            typeof pkg.title === "string" ? pkg.title : "",
            commandRecord.name,
            typeof commandRecord.title === "string" ? commandRecord.title : "",
            typeof commandRecord.description === "string" ? commandRecord.description : ""
          ]
            .filter(Boolean)
            .map((value) => value.toLowerCase()),
          mode:
            commandRecord.mode === "no-view" || commandRecord.mode === "menu-bar"
              ? commandRecord.mode
              : "view",
          title:
            typeof commandRecord.title === "string" && commandRecord.title
              ? commandRecord.title
              : commandRecord.name
        })
      }
    } catch {
      continue
    }
  }

  return results
}

export function listInstalledExternalExtensionSettingsSchemas(): InstalledExternalExtensionSettingsSchema[] {
  const results: InstalledExternalExtensionSettingsSchema[] = []

  for (const source of collectInstalledExtensions()) {
    try {
      const pkg = readExtensionPackage(source.extPath)
      if (!isManifestPlatformCompatible(pkg)) {
        continue
      }

      const commands = Array.isArray(pkg.commands) ? pkg.commands : []
      const commandSchemas: ExternalExtensionCommandSettingsSchema[] = []

      for (const command of commands) {
        if (!command || typeof command !== "object") {
          continue
        }

        const commandRecord = command as Record<string, unknown>
        if (typeof commandRecord.name !== "string" || !commandRecord.name) {
          continue
        }

        if (!isCommandPlatformCompatible(commandRecord)) {
          continue
        }

        const commandPreferences = Array.isArray(commandRecord.preferences)
          ? commandRecord.preferences
              .map((pref) => normalizePreferenceSchema(pref, "command"))
              .filter((pref): pref is ExternalExtensionPreferenceSchema => pref !== null)
          : []

        commandSchemas.push({
          name: commandRecord.name,
          title:
            typeof commandRecord.title === "string" && commandRecord.title
              ? commandRecord.title
              : commandRecord.name,
          description:
            typeof commandRecord.description === "string" ? commandRecord.description : "",
          mode:
            commandRecord.mode === "no-view" || commandRecord.mode === "menu-bar"
              ? commandRecord.mode
              : "view",
          interval: typeof commandRecord.interval === "string" ? commandRecord.interval : undefined,
          disabledByDefault: Boolean(commandRecord.disabledByDefault),
          preferences: commandPreferences
        })
      }

      const extensionPreferences = Array.isArray(pkg.preferences)
        ? pkg.preferences
            .map((pref) => normalizePreferenceSchema(pref, "extension"))
            .filter((pref): pref is ExternalExtensionPreferenceSchema => pref !== null)
        : []

      results.push({
        commands: commandSchemas,
        description: typeof pkg.description === "string" ? pkg.description : "",
        extName: source.extName,
        extensionPath: source.extPath,
        iconDataUrl: getExtensionIconDataUrl(
          source.extPath,
          typeof pkg.icon === "string" ? pkg.icon : "icon.png"
        ),
        owner: getExtensionOwnerLabel(pkg),
        preferences: extensionPreferences,
        sourceRoot: source.sourceRoot,
        title: typeof pkg.title === "string" && pkg.title ? pkg.title : source.extName
      })
    } catch {
      continue
    }
  }

  return results.sort((a, b) => a.title.localeCompare(b.title))
}

export async function buildExternalExtensionCommand(
  extensionName: string,
  commandName: string
): Promise<string> {
  const normalizedExtensionName = normalizeExtensionName(extensionName)
  const extPath = resolveInstalledExtensionPath(normalizedExtensionName)
  if (!extPath) {
    throw new Error(`Extension path not found for "${normalizedExtensionName}"`)
  }

  const pkg = readExtensionPackage(extPath)
  if (!isManifestPlatformCompatible(pkg)) {
    throw new Error(`Extension "${normalizedExtensionName}" is not compatible with this platform`)
  }

  const commands = Array.isArray(pkg.commands) ? pkg.commands : []
  const command = commands.find((item) => {
    return (
      item && typeof item === "object" && (item as Record<string, unknown>).name === commandName
    )
  }) as Record<string, unknown> | undefined

  if (!command) {
    throw new Error(`Command "${commandName}" not found in extension "${normalizedExtensionName}"`)
  }

  if (!isCommandPlatformCompatible(command)) {
    throw new Error(
      `Command "${commandName}" in extension "${normalizedExtensionName}" is not compatible with this platform`
    )
  }

  const entryFile = resolveEntryFile(extPath, command)
  if (!entryFile) {
    throw new Error(
      `Entry file not found for command "${commandName}" in extension "${normalizedExtensionName}"`
    )
  }

  const nodePaths = getExtensionNodePaths(extPath, pkg)

  if (extensionRequiresNodeModules(pkg) && nodePaths.length === 0) {
    throw new Error(
      `Extension "${normalizedExtensionName}" requires node_modules before it can be bundled`
    )
  }

  const externalFromManifest = Array.isArray(pkg.external)
    ? pkg.external.filter(
        (value): value is string => typeof value === "string" && value.trim().length > 0
      )
    : []
  const outFile = path.join(getBuildDir(extPath), `${commandName}.js`)

  const esbuild = requireEsbuild()
  await esbuild.build({
    entryPoints: [entryFile],
    absWorkingDir: extPath,
    bundle: true,
    format: "cjs",
    platform: "node",
    outfile: outFile,
    plugins: [
      {
        name: "swift-external",
        setup(build: any) {
          build.onResolve({ filter: /^swift:/ }, (args: { path: string }) => ({
            external: true,
            path: args.path
          }))
        }
      }
    ],
    external: [
      "react",
      "react-dom",
      "react-dom/*",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
      "@raycast/api",
      "@raycast/utils",
      "re2",
      "better-sqlite3",
      "fsevents",
      "raycast-cross-extension",
      "node-fetch",
      "undici",
      "undici/*",
      "axios",
      "tar",
      "extract-zip",
      "sha256-file",
      ...externalFromManifest,
      ...nodeBuiltins
    ],
    nodePaths,
    target: "es2020",
    jsx: "automatic",
    jsxImportSource: "react",
    tsconfigRaw: getEsbuildTsconfigRaw(extPath),
    define: {
      global: "globalThis",
      "process.env.NODE_ENV": '"production"'
    },
    logLevel: "warning"
  })

  if (!fs.existsSync(outFile)) {
    throw new Error(
      `Build output missing for command "${commandName}" in extension "${normalizedExtensionName}"`
    )
  }

  return outFile
}

export async function getExternalExtensionBundle(
  extensionName: string,
  commandName: string
): Promise<ExternalExtensionBundleResult> {
  const normalizedExtensionName = normalizeExtensionName(extensionName)
  const extPath = resolveInstalledExtensionPath(normalizedExtensionName)
  if (!extPath) {
    const roots = listConfiguredExtensionRoots()
    throw new Error(
      `Extension "${normalizedExtensionName}" not found. Searched roots: ${roots.join(", ")}`
    )
  }

  const outFile = path.join(getBuildDir(extPath), `${commandName}.js`)
  if (!fs.existsSync(outFile)) {
    await buildExternalExtensionCommand(normalizedExtensionName, commandName)
  }

  const code = fs.readFileSync(outFile, "utf-8")
  if (!code) {
    throw new Error(`Bundle for "${normalizedExtensionName}/${commandName}" is empty`)
  }

  const pkg = readExtensionPackage(extPath)
  if (!isManifestPlatformCompatible(pkg)) {
    throw new Error(`Extension "${normalizedExtensionName}" is not compatible with this platform`)
  }

  const commands = Array.isArray(pkg.commands) ? pkg.commands : []
  const command = commands.find((item) => {
    return (
      item && typeof item === "object" && (item as Record<string, unknown>).name === commandName
    )
  }) as Record<string, unknown> | undefined
  if (!command) {
    throw new Error(`Command "${commandName}" not found in extension "${normalizedExtensionName}"`)
  }

  if (!isCommandPlatformCompatible(command)) {
    throw new Error(
      `Command "${commandName}" in extension "${normalizedExtensionName}" is not compatible with this platform`
    )
  }

  const { commandPrefs, definitions, extensionPrefs } = parsePreferences(pkg, commandName)
  const owner = getExtensionOwnerLabel(pkg)
  const supportPath = path.join(
    getOpenworkUserDataPath(),
    "extension-support",
    normalizedExtensionName
  )
  if (!fs.existsSync(supportPath)) {
    fs.mkdirSync(supportPath, { recursive: true })
  }

  return {
    assetsPath: path.join(extPath, "assets"),
    code,
    commandArgumentDefinitions: toCommandArgumentDefinitions(command),
    commandName,
    commandPreferences: commandPrefs,
    extensionDisplayName:
      typeof pkg.title === "string" && pkg.title ? pkg.title : normalizedExtensionName,
    extensionIconDataUrl: getExtensionIconDataUrl(
      extPath,
      typeof pkg.icon === "string" ? pkg.icon : "icon.png"
    ),
    extensionName: normalizedExtensionName,
    extensionPath: extPath,
    mode: command.mode === "no-view" || command.mode === "menu-bar" ? command.mode : "view",
    owner,
    preferenceDefinitions: definitions,
    preferences: {
      ...extensionPrefs,
      ...commandPrefs
    },
    supportPath,
    title: typeof command.title === "string" && command.title ? command.title : String(command.name)
  }
}
