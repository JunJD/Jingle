import fs from "node:fs"
import path from "node:path"
import vm from "node:vm"
import { createRequire } from "node:module"
import ts from "typescript"

export const repoRoot = process.cwd()
export const srcRoot = path.join(repoRoot, "src")
export const sourceExtensions = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"]

export const allowedImportMetaGlobFiles = new Set([
  "src/extensions/index.ts",
  "src/main/services/native-extensions/index.ts"
])

export function listSourceFiles(directory) {
  const entries = fs.readdirSync(directory, { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name)

    if (entry.isDirectory()) {
      files.push(...listSourceFiles(absolutePath))
      continue
    }

    if (!sourceExtensions.includes(path.extname(entry.name))) {
      continue
    }

    files.push(absolutePath)
  }

  return files
}

export function toRepoPath(absolutePath) {
  return path.relative(repoRoot, absolutePath).split(path.sep).join("/")
}

export function isUnder(file, prefix) {
  return file.startsWith(prefix)
}

export function isExact(file, expected) {
  return file === expected
}

export function collectImports(absoluteFilePath) {
  const sourceText = fs.readFileSync(absoluteFilePath, "utf8")
  const sourceFile = ts.createSourceFile(absoluteFilePath, sourceText, ts.ScriptTarget.Latest, true)
  const imports = []

  const visit = (node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      imports.push({
        specifier: node.moduleSpecifier.text,
        line: sourceFile.getLineAndCharacterOfPosition(node.moduleSpecifier.getStart(sourceFile)).line + 1
      })
    }

    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      const specifier = node.arguments[0]
      imports.push({
        specifier: specifier.text,
        line: sourceFile.getLineAndCharacterOfPosition(specifier.getStart(sourceFile)).line + 1
      })
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)

  return imports
}

export function resolveImportPath(fromFile, specifier) {
  if (specifier.startsWith("@/")) {
    return resolveResolvedBase(path.join(repoRoot, "src/renderer/src"), specifier.slice(2))
  }

  if (specifier.startsWith("@extensions/")) {
    return resolveResolvedBase(path.join(repoRoot, "src/extensions"), specifier.slice("@extensions/".length))
  }

  if (specifier.startsWith("@launcher/")) {
    return resolveResolvedBase(
      path.join(repoRoot, "src/renderer/src/launcher"),
      specifier.slice("@launcher/".length)
    )
  }

  if (specifier.startsWith("@plugins/")) {
    return resolveResolvedBase(path.join(repoRoot, "src/plugins"), specifier.slice("@plugins/".length))
  }

  if (specifier.startsWith("@renderer/")) {
    return resolveResolvedBase(path.join(repoRoot, "src/renderer/src"), specifier.slice("@renderer/".length))
  }

  if (specifier.startsWith("@shared/")) {
    return resolveResolvedBase(path.join(repoRoot, "src/shared"), specifier.slice("@shared/".length))
  }

  if (specifier.startsWith(".")) {
    return resolveResolvedBase(path.dirname(fromFile), specifier)
  }

  return null
}

export function readSourceText(repoFilePath) {
  return fs.readFileSync(path.join(repoRoot, repoFilePath), "utf8")
}

export function listNativeExtensionDirectories() {
  const extensionsRoot = path.join(srcRoot, "extensions")

  return fs
    .readdirSync(extensionsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      absolutePath: path.join(extensionsRoot, entry.name),
      name: entry.name,
      repoPath: `src/extensions/${entry.name}`
    }))
    .sort((left, right) => left.name.localeCompare(right.name))
}

export function loadNativeExtensionManifest(extensionDirectory) {
  const manifestModule = loadTypeScriptModule(path.join(extensionDirectory.absolutePath, "manifest.ts"))
  const manifest = Object.values(manifestModule).find(isNativeExtensionManifest)

  if (!manifest) {
    throw new Error(`${extensionDirectory.repoPath}/manifest.ts does not export a native extension manifest`)
  }

  return manifest
}

export function listNativeExtensionRendererCommandNames(extensionDirectory) {
  const rendererSource = readSourceText(`${extensionDirectory.repoPath}/renderer.ts`)
  const commandNames = []

  for (const match of rendererSource.matchAll(/\bname:\s*"([^"]+)"/g)) {
    commandNames.push(match[1])
  }

  return commandNames
}

export function nativeExtensionMainDeclaresService(extensionDirectory) {
  const mainSource = readSourceText(`${extensionDirectory.repoPath}/main.ts`)
  return /\bservice\s*:/.test(mainSource)
}

export function resolveExtensionRelativeFile(extensionDirectory, relativeModulePath) {
  return path.join(extensionDirectory.absolutePath, relativeModulePath)
}

export function resolveExtensionCommandFile(extensionDirectory, commandName) {
  return sourceExtensions
    .map((extension) => path.join(extensionDirectory.absolutePath, "src", `${commandName}${extension}`))
    .find((candidate) => fileExists(candidate))
}

export function fileExists(absolutePath) {
  return fs.existsSync(absolutePath) && fs.statSync(absolutePath).isFile()
}

export function formatViolations(title, violations) {
  if (violations.length === 0) {
    return `${title} passed`
  }

  return [
    `${title} failed`,
    "",
    ...violations.map((violation) =>
      [
        violation.file,
        violation.line ? `  line: ${violation.line}` : null,
        violation.rule ? `  rule: ${violation.rule}` : null,
        violation.import ? `  import: ${violation.import}` : null,
        violation.target ? `  target: ${violation.target}` : null,
        violation.reason ? `  reason: ${violation.reason}` : null
      ]
        .filter(Boolean)
        .join("\n")
    )
  ].join("\n")
}

function resolveResolvedBase(baseDirectory, requestPath) {
  const absoluteBase = path.resolve(baseDirectory, requestPath)
  const direct = resolveFileCandidate(absoluteBase)
  if (direct) {
    return direct
  }

  for (const extension of sourceExtensions) {
    const withExtension = resolveFileCandidate(`${absoluteBase}${extension}`)
    if (withExtension) {
      return withExtension
    }
  }

  for (const extension of sourceExtensions) {
    const indexCandidate = resolveFileCandidate(path.join(absoluteBase, `index${extension}`))
    if (indexCandidate) {
      return indexCandidate
    }
  }

  return null
}

function resolveFileCandidate(candidate) {
  if (!fs.existsSync(candidate)) {
    return null
  }

  const stat = fs.statSync(candidate)
  return stat.isFile() ? candidate : null
}

function isNativeExtensionManifest(value) {
  return (
    !!value &&
    typeof value === "object" &&
    typeof value.name === "string" &&
    typeof value.title === "string" &&
    Array.isArray(value.commands)
  )
}

const moduleCache = new Map()
const nodeRequire = createRequire(import.meta.url)

function loadTypeScriptModule(absolutePath) {
  const cached = moduleCache.get(absolutePath)
  if (cached) {
    return cached.exports
  }

  const sourceText = fs.readFileSync(absolutePath, "utf8")
  const transpiled = ts.transpileModule(sourceText, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true
    },
    fileName: absolutePath
  })

  const module = { exports: {} }
  moduleCache.set(absolutePath, module)

  const localRequire = (specifier) => {
    if (specifier.startsWith(".")) {
      const resolved = resolveResolvedBase(path.dirname(absolutePath), specifier)
      if (!resolved) {
        throw new Error(`Cannot resolve "${specifier}" from "${absolutePath}"`)
      }

      return loadTypeScriptModule(resolved)
    }

    if (
      specifier.startsWith("@extensions/") ||
      specifier.startsWith("@launcher/") ||
      specifier.startsWith("@plugins/") ||
      specifier.startsWith("@shared/")
    ) {
      const resolved = resolveImportPath(absolutePath, specifier)
      if (!resolved) {
        throw new Error(`Cannot resolve "${specifier}" from "${absolutePath}"`)
      }

      return loadTypeScriptModule(resolved)
    }

    return nodeRequire(specifier)
  }

  const context = {
    __dirname: path.dirname(absolutePath),
    __filename: absolutePath,
    exports: module.exports,
    module,
    process,
    require: localRequire
  }

  vm.runInNewContext(transpiled.outputText, context, {
    filename: absolutePath
  })

  return module.exports
}
