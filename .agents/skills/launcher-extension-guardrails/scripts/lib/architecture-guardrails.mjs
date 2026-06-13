import fs from "node:fs"
import path from "node:path"
import vm from "node:vm"
import { createRequire } from "node:module"
import ts from "typescript"

export const repoRoot = process.cwd()
export const srcRoot = path.join(repoRoot, "src")
export const bundledExtensionsRoot = path.join(repoRoot, "extensions")
export const installableExtensionsRoot = path.join(repoRoot, "installable-extensions")
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
        line:
          sourceFile.getLineAndCharacterOfPosition(node.moduleSpecifier.getStart(sourceFile)).line +
          1
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

  if (specifier.startsWith("@ai-core/")) {
    return resolveResolvedBase(
      path.join(repoRoot, "src/renderer/src/ai-core"),
      specifier.slice("@ai-core/".length)
    )
  }

  if (specifier.startsWith("@extension-host/")) {
    return resolveResolvedBase(
      path.join(repoRoot, "src/renderer/src/extension-host"),
      specifier.slice("@extension-host/".length)
    )
  }

  if (specifier.startsWith("@extensions/")) {
    return resolveResolvedBase(
      path.join(repoRoot, "src/extensions"),
      specifier.slice("@extensions/".length)
    )
  }

  if (specifier.startsWith("@launcher-components/")) {
    return resolveResolvedBase(
      path.join(repoRoot, "src/renderer/src/launcher-components"),
      specifier.slice("@launcher-components/".length)
    )
  }

  if (specifier.startsWith("@launcher-shell/")) {
    return resolveResolvedBase(
      path.join(repoRoot, "src/renderer/src/launcher-shell"),
      specifier.slice("@launcher-shell/".length)
    )
  }

  if (specifier.startsWith("@launcher/")) {
    return resolveResolvedBase(
      path.join(repoRoot, "src/renderer/src/launcher-shell"),
      specifier.slice("@launcher/".length)
    )
  }

  if (specifier === "@openwork/extension-api") {
    return resolveResolvedBase(path.join(repoRoot, "packages/extension-api/src"), "index")
  }

  if (specifier.startsWith("@openwork/extension-api/")) {
    return resolveResolvedBase(
      path.join(repoRoot, "packages/extension-api/src"),
      specifier.slice("@openwork/extension-api/".length)
    )
  }

  if (specifier === "@openwork/extension-utils") {
    return resolveResolvedBase(path.join(repoRoot, "packages/extension-utils/src"), "index")
  }

  if (specifier.startsWith("@plugins/")) {
    return resolveResolvedBase(
      path.join(repoRoot, "src/plugins"),
      specifier.slice("@plugins/".length)
    )
  }

  if (specifier.startsWith("@renderer/")) {
    return resolveResolvedBase(
      path.join(repoRoot, "src/renderer/src"),
      specifier.slice("@renderer/".length)
    )
  }

  if (specifier.startsWith("@shared/")) {
    return resolveResolvedBase(
      path.join(repoRoot, "src/shared"),
      specifier.slice("@shared/".length)
    )
  }

  if (specifier.startsWith(".")) {
    return resolveResolvedBase(path.dirname(fromFile), specifier)
  }

  return null
}

export function readSourceText(repoFilePath) {
  return fs.readFileSync(path.join(repoRoot, repoFilePath), "utf8")
}

export function parseSourceFile(absolutePath) {
  const sourceText = fs.readFileSync(absolutePath, "utf8")
  return ts.createSourceFile(absolutePath, sourceText, ts.ScriptTarget.Latest, true)
}

export function listNativeExtensionDirectories() {
  const roots = [
    { absolutePath: bundledExtensionsRoot, repoPath: "extensions" },
    { absolutePath: installableExtensionsRoot, repoPath: "installable-extensions" },
    { absolutePath: path.join(srcRoot, "extensions"), repoPath: "src/extensions" }
  ]
  const extensionDirectories = []

  for (const root of roots) {
    if (!fs.existsSync(root.absolutePath)) {
      continue
    }

    extensionDirectories.push(
      ...fs
        .readdirSync(root.absolutePath, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .filter((entry) =>
          isNativeExtensionPackageDirectory(path.join(root.absolutePath, entry.name))
        )
        .map((entry) => ({
          absolutePath: path.join(root.absolutePath, entry.name),
          name: entry.name,
          repoPath: `${root.repoPath}/${entry.name}`
        }))
    )
  }

  return extensionDirectories.sort((left, right) => left.name.localeCompare(right.name))
}

function isNativeExtensionPackageDirectory(absolutePath) {
  const entries = fs.readdirSync(absolutePath, { withFileTypes: true })

  return entries.some((entry) => {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) {
      return false
    }

    if (entry.isDirectory()) {
      return entry.name === "src" || entry.name === "main"
    }

    if (!entry.isFile()) {
      return false
    }

    return (
      entry.name === "manifest.ts" ||
      entry.name === "main.ts" ||
      entry.name === "runtime.ts" ||
      entry.name === "runtime-metadata.ts" ||
      entry.name === "package.json" ||
      sourceExtensions.includes(path.extname(entry.name))
    )
  })
}

export function isInstallableExtensionDirectory(extensionDirectory) {
  const packageJsonPath = path.join(extensionDirectory.absolutePath, "package.json")
  if (!fileExists(packageJsonPath)) {
    return false
  }

  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"))
  return packageJson.openwork?.distribution === "installable"
}

export function loadNativeExtensionManifest(extensionDirectory) {
  const manifestModule = loadTypeScriptModule(
    path.join(extensionDirectory.absolutePath, "manifest.ts")
  )
  const manifest = Object.values(manifestModule).find(isNativeExtensionManifest)

  if (!manifest) {
    throw new Error(
      `${extensionDirectory.repoPath}/manifest.ts does not export a native extension manifest`
    )
  }

  return manifest
}

export function nativeExtensionMainDeclaresService(extensionDirectory) {
  const mainObject = findTopLevelDefineCallObjectLiteral(
    path.join(extensionDirectory.absolutePath, "main.ts"),
    "defineNativeExtensionMain"
  )

  return !!getObjectPropertyInitializer(mainObject, "service")
}

export function resolveExtensionRelativeFile(extensionDirectory, relativeModulePath) {
  return path.join(extensionDirectory.absolutePath, relativeModulePath)
}

export function resolveExtensionCommandFile(extensionDirectory, commandName) {
  return sourceExtensions
    .map((extension) =>
      path.join(extensionDirectory.absolutePath, "src", `${commandName}${extension}`)
    )
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

export function listTopLevelManifestRegistryExtensionNames() {
  return listTopLevelArrayRegistryExtensionNames(
    path.join(repoRoot, "src/extensions/index.ts"),
    "nativeExtensionManifests"
  )
}

export function listTopLevelMainRegistryExtensionNames() {
  return listTopLevelMapRegistryExtensionNames(
    path.join(repoRoot, "src/extensions/main.ts"),
    "nativeExtensionMainDefinitions"
  )
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

function listTopLevelArrayRegistryExtensionNames(absolutePath, exportName) {
  const sourceFile = parseSourceFile(absolutePath)
  const importedExtensionIds = collectImportedExtensionIds(sourceFile)
  const initializer = getExportedConstInitializer(sourceFile, exportName)
  const arrayLiteral = unwrapArrayInitializer(initializer)

  if (!arrayLiteral) {
    throw new Error(`${toRepoPath(absolutePath)} must export ${exportName} as an array registry`)
  }

  return arrayLiteral.elements.map((element) => {
    if (ts.isIdentifier(element)) {
      return resolveImportedExtensionId(importedExtensionIds, element.text, absolutePath)
    }

    throw new Error(
      `${toRepoPath(absolutePath)} must declare ${exportName} entries as imported manifest identifiers`
    )
  })
}

function listTopLevelMapRegistryExtensionNames(absolutePath, exportName) {
  const sourceFile = parseSourceFile(absolutePath)
  const importedExtensionIds = collectImportedExtensionIds(sourceFile)
  const initializer = getExportedConstInitializer(sourceFile, exportName)

  if (
    !initializer ||
    !ts.isNewExpression(initializer) ||
    !ts.isIdentifier(initializer.expression) ||
    initializer.expression.text !== "Map"
  ) {
    throw new Error(`${toRepoPath(absolutePath)} must export ${exportName} as a Map registry`)
  }

  const entriesArgument = initializer.arguments?.[0]
  if (!entriesArgument || !ts.isArrayLiteralExpression(entriesArgument)) {
    throw new Error(`${toRepoPath(absolutePath)} must initialize ${exportName} with Map entries`)
  }

  return entriesArgument.elements.map((entry) => {
    if (!ts.isArrayLiteralExpression(entry) || entry.elements.length === 0) {
      throw new Error(
        `${toRepoPath(absolutePath)} must declare each ${exportName} entry as a tuple`
      )
    }

    return resolveRegistryKeyExtensionId(entry.elements[0], importedExtensionIds, absolutePath)
  })
}

function findTopLevelDefineCallObjectLiteral(absolutePath, factoryName) {
  const sourceFile = parseSourceFile(absolutePath)

  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) {
      continue
    }

    for (const declaration of statement.declarationList.declarations) {
      const initializer = declaration.initializer
      if (
        !initializer ||
        !ts.isCallExpression(initializer) ||
        !ts.isIdentifier(initializer.expression) ||
        initializer.expression.text !== factoryName
      ) {
        continue
      }

      const argument = initializer.arguments[0]
      if (!argument || !ts.isObjectLiteralExpression(argument)) {
        throw new Error(
          `${toRepoPath(absolutePath)} must pass an object literal to ${factoryName}(...)`
        )
      }

      return argument
    }
  }

  throw new Error(`${toRepoPath(absolutePath)} must export a ${factoryName}(...) definition`)
}

function getExportedConstInitializer(sourceFile, exportName) {
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) {
      continue
    }

    if (!statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) {
      continue
    }

    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.name.text === exportName) {
        return declaration.initializer ?? null
      }
    }
  }

  return null
}

function unwrapArrayInitializer(initializer) {
  if (!initializer) {
    return null
  }

  if (ts.isArrayLiteralExpression(initializer)) {
    return initializer
  }

  if (
    ts.isCallExpression(initializer) &&
    ts.isPropertyAccessExpression(initializer.expression) &&
    initializer.expression.name.text === "sort" &&
    ts.isArrayLiteralExpression(initializer.expression.expression)
  ) {
    return initializer.expression.expression
  }

  return null
}

function getObjectPropertyInitializer(objectLiteral, propertyName) {
  for (const property of objectLiteral.properties) {
    if (!ts.isPropertyAssignment(property)) {
      continue
    }

    if (getPropertyNameText(property.name) === propertyName) {
      return property.initializer
    }
  }

  return null
}

function getPropertyNameText(nameNode) {
  if (ts.isIdentifier(nameNode) || ts.isStringLiteral(nameNode)) {
    return nameNode.text
  }

  return null
}

function collectImportedExtensionIds(sourceFile) {
  const importedExtensionIds = new Map()

  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
      continue
    }

    const extensionId = inferImportedExtensionId(statement.moduleSpecifier.text)
    if (!extensionId) {
      continue
    }

    const namedBindings = statement.importClause?.namedBindings
    if (!namedBindings || !ts.isNamedImports(namedBindings)) {
      continue
    }

    for (const element of namedBindings.elements) {
      importedExtensionIds.set(element.name.text, extensionId)
    }
  }

  return importedExtensionIds
}

function inferImportedExtensionId(specifier) {
  const match = specifier.match(
    /^(?:\.\/|\.\.\/\.\.\/extensions\/)([^/]+)\/(?:manifest|renderer|main)$/
  )
  return match?.[1] ?? null
}

function resolveImportedExtensionId(importedExtensionIds, identifierName, absolutePath) {
  const extensionId = importedExtensionIds.get(identifierName)
  if (!extensionId) {
    throw new Error(
      `${toRepoPath(absolutePath)} references "${identifierName}" but it is not an imported extension binding`
    )
  }

  return extensionId
}

function resolveRegistryKeyExtensionId(expression, importedExtensionIds, absolutePath) {
  if (ts.isStringLiteral(expression)) {
    return expression.text
  }

  if (
    ts.isPropertyAccessExpression(expression) &&
    ts.isIdentifier(expression.expression) &&
    expression.name.text === "name"
  ) {
    return resolveImportedExtensionId(
      importedExtensionIds,
      expression.expression.text,
      absolutePath
    )
  }

  if (ts.isIdentifier(expression)) {
    return resolveImportedExtensionId(importedExtensionIds, expression.text, absolutePath)
  }

  throw new Error(
    `${toRepoPath(absolutePath)} must declare registry keys as imported manifest names or string literals`
  )
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
    isLocalizedTextValue(value.title) &&
    Array.isArray(value.commands)
  )
}

function isLocalizedTextValue(value) {
  if (typeof value === "string") {
    return true
  }

  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    typeof value.en_US === "string" &&
    typeof value.zh_Hans === "string"
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
      specifier.startsWith("@ai-core/") ||
      specifier.startsWith("@extension-host/") ||
      specifier.startsWith("@extensions/") ||
      specifier.startsWith("@launcher-components/") ||
      specifier.startsWith("@launcher-shell/") ||
      specifier.startsWith("@launcher/") ||
      specifier === "@openwork/extension-api" ||
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
