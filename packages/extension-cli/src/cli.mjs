#!/usr/bin/env node
import { createHash } from "node:crypto"
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, watch, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { build } from "esbuild"
import ts from "typescript"

const repoRoot = process.cwd()
const defaultOutputRoot = resolve(repoRoot, ".jingle-build", "installed-extensions")
const reactBridgeGlobalKey = "jingle.extensionRuntime.reactBridge"
const reactBridgeVersion = 1

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
  console.log("Jingle dev discovers this root at process startup when ELECTRON_RENDERER_URL is set.")
  console.log("Restart the Jingle dev app after rebuilds; extension hot reload is not implemented.")
  watchExtension(extensionRef, outputRoot, trustOverride)
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
  } catch (error) {
    if (!options.swallowErrors) {
      throw error
    }
    console.error(error instanceof Error ? error.message : String(error))
  }
}

function reportBuildResult(result) {
  console.log(
    `Built ${result.id}@${result.version}: ${result.packageRoot} (trust: ${result.trust})`
  )
  if (result.trust !== "trusted") {
    console.log("Privileged Electron main module loading is disabled for this package.")
  }
}

function watchExtension(extensionRef, outputRoot, trustOverride) {
  const extensionRoot = resolveExtensionRoot(extensionRef)
  let timer = null

  watch(extensionRoot, { recursive: true }, (_eventType, filename) => {
    if (!filename || shouldIgnoreWatchedPath(String(filename))) {
      return
    }

    clearTimeout(timer)
    timer = setTimeout(() => {
      void buildAndReport(extensionRef, outputRoot, trustOverride, { swallowErrors: true })
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

  rmSync(packageRoot, { force: true, recursive: true })
  mkdirSync(join(packageRoot, "dist"), { recursive: true })

  writeJson(join(packageRoot, "manifest.json"), manifest)
  writeJson(join(packageRoot, "runtime-metadata.json"), runtimeMetadata)
  writeJson(join(packageRoot, "jingle.extension.json"), {
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

  const assetsDir = join(extensionRoot, "assets")
  if (!existsSync(assetsDir)) {
    throw new Error(`Extension assets directory is missing: ${assetsDir}`)
  }
  cpSync(assetsDir, join(packageRoot, "assets"), { recursive: true })

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
    outfile: join(packageRoot, "dist", "runtime.mjs"),
    source: `export { ${runtimeExportName} as default } from "./runtime"\n`,
    sourcefile: `${manifest.name}-runtime-entry.ts`
  })
  await buildModuleFromSource({
    extensionRoot,
    external: ["electron"],
    outfile: join(packageRoot, "dist", "main.mjs"),
    source: `export { ${mainExportName} as default } from "./main"\n`,
    sourcefile: `${manifest.name}-main-entry.ts`
  })

  return {
    id: manifest.name,
    packageRoot,
    trust,
    version
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
  const cacheDir = join(repoRoot, ".jingle-build", "extension-cli-cache")
  mkdirSync(cacheDir, { recursive: true })
  const cacheKey = createHash("sha1")
    .update(`${extensionRoot}:${entryName}:${Date.now()}`)
    .digest("hex")
  const outfile = join(cacheDir, `${cacheKey}.mjs`)

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

  return import(`${pathToFileURL(outfile).href}?cache=${cacheKey}`)
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
