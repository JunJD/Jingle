#!/usr/bin/env node
import { randomUUID } from "node:crypto"
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  watch,
  writeFileSync
} from "node:fs"
import { mkdtemp, rename, rm } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import { pathToFileURL } from "node:url"
import { build } from "esbuild"
import ts from "typescript"

const repoRoot = process.cwd()
const defaultOutputRoot = resolve(repoRoot, ".jingle-build", "installed-extensions")
const extensionPackageTemporaryDirectoryPrefix = ".jingle-extension-tmp-"
const reactBridgeGlobalKey = "jingle.extensionRuntime.reactBridge"
const reactBridgeVersion = 1
const windowsFilesystemRetryCodes = new Set(["EACCES", "EBUSY", "EPERM"])

const command = process.argv[2]
const args = process.argv.slice(3)

if (!command || command === "--help" || command === "-h") {
  printHelp()
  process.exit(0)
}

if (command === "build") {
  const options = parseOptions(args)
  const extensionRefs = options.positionals
  if (extensionRefs.length === 0) {
    throw new Error("Usage: jingle-extension build <extension-id-or-path...> [--trust <level>]")
  }

  for (const extensionRef of extensionRefs) {
    const result = await buildExtension({
      extensionRef,
      outputRoot: options.flags["out-dir"] ?? defaultOutputRoot,
      trustOverride: options.flags.trust
    })
    reportBuildResult(result)
  }
} else if (command === "dev") {
  const options = parseOptions(args)
  const extensionRef = options.positionals[0]
  if (!extensionRef) {
    throw new Error("Usage: jingle-extension dev <extension-id-or-path> [--trust <level>]")
  }

  const outputRoot = options.flags["out-dir"] ?? defaultOutputRoot
  const trustOverride = options.flags.trust
  const result = await buildExtension({ extensionRef, outputRoot, trustOverride })
  reportBuildResult(result)
  console.log(`Dev output root: ${outputRoot}`)
  console.log(
    "Jingle dev discovers this root at process startup when ELECTRON_RENDERER_URL is set."
  )
  console.log("Restart the Jingle dev app after rebuilds; extension hot reload is not implemented.")
  watchExtension(extensionRef, outputRoot, trustOverride, result.packageRoot)
} else {
  throw new Error(`Unknown extension command "${command}".`)
}

function printHelp() {
  console.log(`
jingle-extension

Usage:
  jingle-extension build <extension-id-or-path...> [--out-dir <dir>] [--trust trusted|untrusted]
  jingle-extension dev <extension-id-or-path> [--out-dir <dir>] [--trust trusted|untrusted]

Commands:
  build   Build one or more installable extension package directories.
  dev     Build once into the installed-extension output root, then watch and rebuild.

Trust:
  Package defaults to jingle.trust from package.json, or "untrusted" when omitted.
  Only trusted installed packages may load privileged Electron main modules.
`)
}

function parseOptions(inputArgs) {
  const flags = {}
  const positionals = []

  for (let index = 0; index < inputArgs.length; index += 1) {
    const arg = inputArgs[index]
    if (arg === "--") {
      positionals.push(...inputArgs.slice(index + 1))
      break
    }

    if (arg === "--out-dir") {
      const value = inputArgs[index + 1]
      if (!value) {
        throw new Error("--out-dir requires a directory")
      }
      flags["out-dir"] = resolve(repoRoot, value)
      index += 1
      continue
    }

    if (arg === "--trust") {
      const value = inputArgs[index + 1]
      if (!value) {
        throw new Error("--trust requires trusted or untrusted")
      }
      if (value !== "trusted" && value !== "untrusted") {
        throw new Error("--trust must be trusted or untrusted")
      }
      flags.trust = value
      index += 1
      continue
    }

    positionals.push(arg)
  }

  return { flags, positionals }
}

async function buildAndReport(extensionRef, outputRoot, trustOverride, options = {}) {
  try {
    const result = await buildExtension({ extensionRef, outputRoot, trustOverride })
    reportBuildResult(result)
    return result
  } catch (error) {
    if (!options.swallowErrors) {
      throw error
    }
    reportBuildFailure(error, options.publishedPackageRoot)
    console.error(error instanceof Error ? error.message : String(error))
    return null
  }
}

function reportBuildFailure(error, previouslyPublishedPackageRoot) {
  const status = resolvePublishedArtifactStatus(error, previouslyPublishedPackageRoot)
  if (status.kind === "final") {
    console.error(
      `New extension build failed; continuing to use the previously published extension package: ${status.packageRoot}`
    )
    return
  }
  if (status.kind === "backup") {
    console.error(
      `New extension build failed, and rollback could not restore the previously published extension package. ` +
        `The package remains in backup and is not available to Jingle: ${status.packageRoot}`
    )
    return
  }
  console.error(
    "New extension build failed; no previously published extension package is available."
  )
}

function resolvePublishedArtifactStatus(error, previouslyPublishedPackageRoot) {
  const rollback = getRollbackFailureFacts(error)
  if (
    rollback &&
    rollback.packageRoot === previouslyPublishedPackageRoot &&
    isPackageDirectoryPresent(rollback.backupRoot)
  ) {
    return { kind: "backup", packageRoot: rollback.backupRoot }
  }
  if (previouslyPublishedPackageRoot && isPackageDirectoryPresent(previouslyPublishedPackageRoot)) {
    return { kind: "final", packageRoot: previouslyPublishedPackageRoot }
  }
  return { kind: "none" }
}

function reportBuildResult(result) {
  console.log(
    `Built ${result.id}@${result.version}: ${result.packageRoot} (trust: ${result.trust})`
  )
  if (result.trust !== "trusted") {
    console.log("Privileged Electron main module loading is disabled for this package.")
  }
}

function watchExtension(extensionRef, outputRoot, trustOverride, initialPublishedPackageRoot) {
  const extensionRoot = resolveExtensionRoot(extensionRef)
  let publishedPackageRoot = initialPublishedPackageRoot
  let rebuildInFlight = false
  let rebuildQueued = false
  let timer = null

  const rebuild = async () => {
    if (rebuildInFlight) {
      rebuildQueued = true
      return
    }

    rebuildInFlight = true
    try {
      do {
        rebuildQueued = false
        const result = await buildAndReport(extensionRef, outputRoot, trustOverride, {
          publishedPackageRoot,
          swallowErrors: true
        })
        if (result) {
          publishedPackageRoot = result.packageRoot
        }
      } while (rebuildQueued)
    } finally {
      rebuildInFlight = false
    }
  }

  watch(extensionRoot, { recursive: true }, (_eventType, filename) => {
    if (!filename || shouldIgnoreWatchedPath(String(filename))) {
      return
    }

    clearTimeout(timer)
    timer = setTimeout(() => {
      void rebuild()
    }, 150)
  })
}

function shouldIgnoreWatchedPath(filename) {
  return filename.includes("node_modules/") || filename.includes("/dist/")
}

async function buildExtension(input) {
  const extensionRoot = resolveExtensionRoot(input.extensionRef)
  const packageJson = readPackageJson(extensionRoot)
  const manifest = await loadNativeExtensionManifest(extensionRoot)
  const runtimeMetadata = await loadRuntimeMetadata(extensionRoot)
  const version = packageJson.version ?? "0.0.0"
  const trust = resolvePackageTrust(packageJson, input.trustOverride)
  const packageRoot = resolve(input.outputRoot, manifest.name, version)
  const packageParent = dirname(packageRoot)
  const stagingRoot = join(
    packageParent,
    `${extensionPackageTemporaryDirectoryPrefix}staging-${randomUUID()}`
  )

  try {
    mkdirSync(join(stagingRoot, "dist"), { recursive: true })
    writeJson(join(stagingRoot, "manifest.json"), manifest)
    writeJson(join(stagingRoot, "runtime-metadata.json"), runtimeMetadata)

    const assetsDir = join(extensionRoot, "assets")
    if (!existsSync(assetsDir)) {
      throw new Error(`Extension assets directory is missing: ${assetsDir}`)
    }
    cpSync(assetsDir, join(stagingRoot, "assets"), { recursive: true })

    const runtimeExportName = findDefinitionExportName(
      join(extensionRoot, "runtime.ts"),
      "defineNativeExtensionRuntime"
    )
    const mainExportName = findDefinitionExportName(
      join(extensionRoot, "main.ts"),
      "defineNativeExtensionMain"
    )

    await buildModuleFromSource({
      extensionRoot,
      installRuntimeReactShim: true,
      outfile: join(stagingRoot, "dist", "runtime.mjs"),
      source: `export { ${runtimeExportName} as default } from "./runtime"\n`,
      sourcefile: `${manifest.name}-runtime-entry.ts`
    })
    await buildModuleFromSource({
      extensionRoot,
      external: ["electron"],
      outfile: join(stagingRoot, "dist", "main.mjs"),
      source: `export { ${mainExportName} as default } from "./main"\n`,
      sourcefile: `${manifest.name}-main-entry.ts`
    })

    writeJson(join(stagingRoot, "jingle.extension.json"), {
      assets: "./assets",
      id: manifest.name,
      main: "./dist/main.mjs",
      manifest: "./manifest.json",
      runtime: "./dist/runtime.mjs",
      runtimeMetadata: "./runtime-metadata.json",
      schemaVersion: 1,
      trust,
      version
    })
    await publishPackageDirectory(stagingRoot, packageRoot)
  } catch (error) {
    const cleanupError = await removePackageDirectory(stagingRoot)
    if (cleanupError) {
      const cleanupFailure = new AggregateError(
        [error, cleanupError],
        `Extension build failed and staging cleanup also failed: ${stagingRoot}`
      )
      copyRollbackFailureFacts(error, cleanupFailure)
      throw cleanupFailure
    }
    throw error
  }

  return {
    id: manifest.name,
    packageRoot,
    trust,
    version
  }
}

async function publishPackageDirectory(stagingRoot, packageRoot) {
  const backupRoot = join(
    dirname(packageRoot),
    `${extensionPackageTemporaryDirectoryPrefix}backup-${randomUUID()}`
  )
  let previousArtifactMoved = false

  try {
    if (existsSync(packageRoot)) {
      await renameDirectoryWithRetry(packageRoot, backupRoot)
      previousArtifactMoved = true
    }
    await renameDirectoryWithRetry(stagingRoot, packageRoot)
  } catch (publishError) {
    if (previousArtifactMoved && !existsSync(packageRoot)) {
      try {
        await renameDirectoryWithRetry(backupRoot, packageRoot)
      } catch (rollbackError) {
        const error = new AggregateError(
          [publishError, rollbackError],
          `Extension publish failed and rollback could not restore ${packageRoot}; previous artifact remains at ${backupRoot}`
        )
        error.code = "JINGLE_EXTENSION_PUBLISH_ROLLBACK_FAILED"
        error.publishedPackageRollback = { backupRoot, packageRoot }
        throw error
      }
    }
    throw publishError
  }

  if (previousArtifactMoved) {
    const cleanupError = await removePackageDirectory(backupRoot)
    if (cleanupError) {
      console.warn(
        `Published extension but could not remove ignored backup directory: ${backupRoot}`
      )
      console.warn(cleanupError instanceof Error ? cleanupError.message : String(cleanupError))
    }
  }
}

function getRollbackFailureFacts(error) {
  if (!error || typeof error !== "object") {
    return null
  }
  if (
    error.code !== "JINGLE_EXTENSION_PUBLISH_ROLLBACK_FAILED" ||
    !error.publishedPackageRollback ||
    typeof error.publishedPackageRollback !== "object" ||
    typeof error.publishedPackageRollback.backupRoot !== "string" ||
    typeof error.publishedPackageRollback.packageRoot !== "string"
  ) {
    return null
  }
  return error.publishedPackageRollback
}

function copyRollbackFailureFacts(source, target) {
  const rollback = getRollbackFailureFacts(source)
  if (!rollback) {
    return
  }
  target.code = "JINGLE_EXTENSION_PUBLISH_ROLLBACK_FAILED"
  target.publishedPackageRollback = rollback
}

function isPackageDirectoryPresent(packageRoot) {
  try {
    return statSync(packageRoot).isDirectory()
  } catch {
    return false
  }
}

async function renameDirectoryWithRetry(source, destination) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rename(source, destination)
      return
    } catch (error) {
      if (!isWindowsFilesystemLockError(error) || attempt >= 5) {
        throw error
      }
      await delay((attempt + 1) * 100)
    }
  }
}

function isWindowsFilesystemLockError(error) {
  return (
    error instanceof Error &&
    "code" in error &&
    typeof error.code === "string" &&
    windowsFilesystemRetryCodes.has(error.code)
  )
}

async function removePackageDirectory(packageRoot) {
  if (!existsSync(packageRoot)) {
    return null
  }

  try {
    await rm(packageRoot, { force: true, maxRetries: 5, recursive: true, retryDelay: 100 })
    return null
  } catch (error) {
    return error
  }
}

function resolvePackageTrust(packageJson, trustOverride) {
  if (trustOverride) {
    return trustOverride
  }

  const packageTrust = packageJson.jingle?.trust
  if (!packageTrust) {
    return "untrusted"
  }
  if (packageTrust === "trusted" || packageTrust === "untrusted") {
    return packageTrust
  }

  throw new Error('package.json jingle.trust must be "trusted" or "untrusted"')
}

function resolveExtensionRoot(extensionRef) {
  const directPath = resolve(repoRoot, extensionRef)
  if (existsSync(directPath)) {
    return directPath
  }

  const installableSourcePath = resolve(repoRoot, "installable-extensions", extensionRef)
  if (existsSync(installableSourcePath)) {
    return installableSourcePath
  }

  const bundledPath = resolve(repoRoot, "extensions", extensionRef)
  if (existsSync(bundledPath)) {
    return bundledPath
  }

  throw new Error(`Extension source package not found: ${extensionRef}`)
}

function readPackageJson(extensionRoot) {
  const packageJsonPath = join(extensionRoot, "package.json")
  if (!existsSync(packageJsonPath)) {
    throw new Error(`Extension package.json is missing: ${packageJsonPath}`)
  }

  return JSON.parse(readFileSync(packageJsonPath, "utf8"))
}

async function loadNativeExtensionManifest(extensionRoot) {
  const module = await loadBundledDefinitionModule(extensionRoot, "manifest.ts")
  const manifest = Object.values(module).find(isNativeExtensionManifest)
  if (!manifest) {
    throw new Error(`${extensionRoot}/manifest.ts does not export a native extension manifest`)
  }

  return manifest
}

async function loadRuntimeMetadata(extensionRoot) {
  const module = await loadBundledDefinitionModule(extensionRoot, "runtime-metadata.ts")
  const metadata = Object.values(module).find(isRuntimeMetadata)
  if (!metadata) {
    throw new Error(`${extensionRoot}/runtime-metadata.ts does not export runtime metadata`)
  }

  assertJsonSafeRuntimeMetadata(metadata, extensionRoot)
  return metadata
}

async function loadBundledDefinitionModule(extensionRoot, entryName) {
  const cacheRoot = join(repoRoot, ".jingle-build", "extension-cli-cache")
  mkdirSync(cacheRoot, { recursive: true })
  const temporaryDir = await mkdtemp(join(cacheRoot, "definition-"))
  const outfile = join(temporaryDir, "bundle.mjs")

  let loadedModule
  try {
    await build({
      bundle: true,
      entryPoints: [join(extensionRoot, entryName)],
      external: ["electron"],
      format: "esm",
      jsx: "automatic",
      logLevel: "silent",
      outfile,
      packages: "bundle",
      platform: "node",
      plugins: [extensionApiSourceAliasPlugin()],
      target: "node18"
    })
    loadedModule = await import(pathToFileURL(outfile).href)
  } catch (error) {
    const cleanupError = await removePackageDirectory(temporaryDir)
    if (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        `Extension definition load failed and temporary directory cleanup also failed: ${temporaryDir}`
      )
    }
    throw error
  }

  const cleanupError = await removePackageDirectory(temporaryDir)
  if (cleanupError) {
    throw new Error(`Extension definition temporary directory cleanup failed: ${temporaryDir}`, {
      cause: cleanupError
    })
  }
  return loadedModule
}

function isNativeExtensionManifest(value) {
  return (
    !!value &&
    typeof value === "object" &&
    typeof value.name === "string" &&
    Array.isArray(value.commands)
  )
}

function isRuntimeMetadata(value) {
  return (
    !!value &&
    typeof value === "object" &&
    typeof value.extensionName === "string" &&
    Array.isArray(value.commands)
  )
}

function assertJsonSafeRuntimeMetadata(metadata, extensionRoot) {
  const invalidPath = findNonJsonSafePath(metadata, "runtime-metadata")
  if (invalidPath) {
    throw new Error(
      `${extensionRoot}/runtime-metadata.ts contains non-JSON metadata at ${invalidPath}. ` +
        "Function search adapters cannot be written to installable package metadata."
    )
  }
}

function findNonJsonSafePath(value, path) {
  if (value === null) {
    return null
  }

  const valueType = typeof value
  if (valueType === "string" || valueType === "boolean") {
    return null
  }

  if (valueType === "number") {
    return Number.isFinite(value) ? null : path
  }

  if (
    valueType === "bigint" ||
    valueType === "function" ||
    valueType === "symbol" ||
    valueType === "undefined"
  ) {
    return path
  }

  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const invalidPath = findNonJsonSafePath(value[index], `${path}[${index}]`)
      if (invalidPath) {
        return invalidPath
      }
    }
    return null
  }

  if (valueType === "object") {
    for (const [key, childValue] of Object.entries(value)) {
      const invalidPath = findNonJsonSafePath(childValue, `${path}.${key}`)
      if (invalidPath) {
        return invalidPath
      }
    }
  }

  return null
}

function writeJson(filePath, value) {
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`)
}

function findDefinitionExportName(filePath, factoryName) {
  const sourceText = readFileSync(filePath, "utf8")
  const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true)

  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) {
      continue
    }

    if (!statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) {
      continue
    }

    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name)) {
        continue
      }

      const initializer = declaration.initializer
      if (
        initializer &&
        ts.isCallExpression(initializer) &&
        ts.isIdentifier(initializer.expression) &&
        initializer.expression.text === factoryName
      ) {
        return declaration.name.text
      }
    }
  }

  throw new Error(`${filePath} must export ${factoryName}(...)`)
}

async function buildModuleFromSource(input) {
  const plugins = [extensionApiSourceAliasPlugin()]
  if (input.installRuntimeReactShim) {
    plugins.push(jingleRuntimeShimPlugin())
  }

  await build({
    banner: {
      js: 'import { createRequire as __jingleCreateRequire } from "node:module"; const require = __jingleCreateRequire(import.meta.url);'
    },
    bundle: true,
    external: input.external ?? [],
    format: "esm",
    jsx: "automatic",
    logLevel: "silent",
    outfile: input.outfile,
    packages: "bundle",
    platform: "node",
    plugins,
    stdin: {
      contents: input.source,
      loader: "ts",
      resolveDir: input.extensionRoot,
      sourcefile: input.sourcefile
    },
    target: "node18"
  })
}

function extensionApiSourceAliasPlugin() {
  const extensionApiAliases = [
    ["@jingle/extension-api", "packages/extension-api/src/index.ts"],
    ["@jingle/extension-api/host-runtime", "packages/extension-api/src/host-runtime.ts"],
    ["@jingle/extension-utils", "packages/extension-utils/src/index.ts"]
  ]

  return {
    name: "jingle-extension-api-alias",
    setup(build) {
      for (const [specifier, targetPath] of extensionApiAliases) {
        build.onResolve({ filter: new RegExp(`^${escapeRegExp(specifier)}$`) }, () => ({
          path: resolve(repoRoot, targetPath)
        }))
      }
    }
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function jingleRuntimeShimPlugin() {
  return {
    name: "jingle-runtime-shim",
    setup(build) {
      build.onResolve({ filter: /^react$/ }, () => ({
        namespace: "jingle-runtime-shim",
        path: "react"
      }))
      build.onResolve({ filter: /^react\/jsx-runtime$/ }, () => ({
        namespace: "jingle-runtime-shim",
        path: "react/jsx-runtime"
      }))
      build.onResolve({ filter: /^react\/jsx-dev-runtime$/ }, () => ({
        namespace: "jingle-runtime-shim",
        path: "react/jsx-dev-runtime"
      }))
      build.onLoad({ filter: /^react$/, namespace: "jingle-runtime-shim" }, () => ({
        contents: reactShimSource(),
        loader: "js"
      }))
      build.onLoad({ filter: /^react\/jsx-runtime$/, namespace: "jingle-runtime-shim" }, () => ({
        contents: reactJsxRuntimeShimSource("jsxRuntime"),
        loader: "js"
      }))
      build.onLoad(
        { filter: /^react\/jsx-dev-runtime$/, namespace: "jingle-runtime-shim" },
        () => ({
          contents: reactJsxRuntimeShimSource("jsxDevRuntime"),
          loader: "js"
        })
      )
    }
  }
}

function reactShimSource() {
  const namedExports = [
    "Children",
    "Component",
    "Fragment",
    "Profiler",
    "PureComponent",
    "StrictMode",
    "Suspense",
    "cache",
    "cloneElement",
    "createContext",
    "createElement",
    "createRef",
    "forwardRef",
    "isValidElement",
    "lazy",
    "memo",
    "startTransition",
    "use",
    "useActionState",
    "useCallback",
    "useContext",
    "useDebugValue",
    "useDeferredValue",
    "useEffect",
    "useId",
    "useImperativeHandle",
    "useInsertionEffect",
    "useLayoutEffect",
    "useMemo",
    "useOptimistic",
    "useReducer",
    "useRef",
    "useState",
    "useSyncExternalStore",
    "useTransition",
    "version"
  ]

  return `
${reactBridgeSource("React", "React")}
${namedExports.map((name) => `export const ${name} = React.${name}`).join("\n")}
export default React
`
}

function reactJsxRuntimeShimSource(bridgeProperty) {
  return `
${reactBridgeSource("jsxRuntime", bridgeProperty)}
export const Fragment = jsxRuntime.Fragment
export const jsx = jsxRuntime.jsx
export const jsxs = jsxRuntime.jsxs
export const jsxDEV = jsxRuntime.jsxDEV
`
}

function reactBridgeSource(localName, bridgeProperty) {
  return `
const bridge = globalThis[Symbol.for(${JSON.stringify(reactBridgeGlobalKey)})]
if (!bridge || typeof bridge !== "object") {
  throw new Error("Jingle extension runtime React bridge is not installed.")
}
if (bridge.version !== ${reactBridgeVersion}) {
  throw new Error("Jingle extension runtime React bridge version " + bridge.version + " is not supported.")
}
const ${localName} = bridge.${bridgeProperty}
if (!${localName}) {
  throw new Error("Jingle extension runtime React bridge is missing ${bridgeProperty}.")
}
`
}
