import fs from "node:fs"
import { builtinModules } from "node:module"
import path from "node:path"
import ts from "typescript"

const sourceExtensions = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"])
const forbiddenHostAliases = [
  "@/",
  "@ai-core/",
  "@extension-host/",
  "@extensions/",
  "@launcher/",
  "@launcher-components/",
  "@launcher-shell/",
  "@plugins/",
  "@renderer/",
  "@shared/"
]
const allowedOpenworkPackages = new Set(["@openwork/extension-api", "@openwork/extension-utils"])
const forbiddenSourceRuntimePackages = new Map([
  ["@raycast/api", "@openwork/extension-api"],
  ["@raycast/utils", "@openwork/extension-utils"]
])
const mainOnlyPackages = new Set(["electron"])
const nodeBuiltins = new Set([
  ...builtinModules,
  ...builtinModules.map((moduleName) => `node:${moduleName}`)
])
const requiredPackageEntries = [
  { kind: "file", path: "manifest.ts", reason: "extension package must provide a manifest entry file" },
  { kind: "file", path: "runtime.ts", reason: "extension package must provide a runtime entry file" },
  { kind: "file", path: "runtime-metadata.ts", reason: "extension package must provide a runtime metadata file" },
  { kind: "file", path: "main.ts", reason: "extension package must provide a main-process entry file" },
  { kind: "directory", path: "main", reason: "extension package must keep main-process code under main/" },
  { kind: "directory", path: "src", reason: "extension package must keep command/source code under src/" },
  { kind: "directory", path: "assets", reason: "extension package must own its assets under assets/" }
]

export function validateNativeExtensionPackageBoundaries(options = {}) {
  const repoRoot = options.repoRoot ? path.resolve(options.repoRoot) : process.cwd()
  const extensionsRoot = path.join(repoRoot, "extensions")
  const violations = []

  if (!fs.existsSync(extensionsRoot)) {
    return { errors: [], violations: [] }
  }

  for (const extensionDirectory of listExtensionPackageDirectories(extensionsRoot)) {
    const packageJsonPath = path.join(extensionDirectory, "package.json")
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"))
    const sourceFiles = listSourceFiles(extensionDirectory)
    const identityContext = collectPackageStringConstants(sourceFiles)
    violations.push(
      ...validatePackageShape({
        extensionDirectory,
        packageJson,
        packageJsonPath,
        repoRoot
      })
    )
    violations.push(
      ...validatePackageEntryIdentities({
        extensionDirectory,
        identityContext,
        repoRoot
      })
    )
    violations.push(
      ...validateManifestAssetReferences({
        extensionDirectory,
        identityContext,
        repoRoot
      })
    )
    violations.push(
      ...validateRuntimeMetadataImportGraph({
        extensionDirectory,
        repoRoot
      })
    )
    violations.push(
      ...validateMainEntryImportGraph({
        extensionDirectory,
        repoRoot
      })
    )
    violations.push(
      ...validatePackageCommandSurfaces({
        extensionDirectory,
        identityContext,
        repoRoot
      })
    )
    violations.push(
      ...validatePackageMainCapabilitySurface({
        extensionDirectory,
        identityContext,
        repoRoot
      })
    )
    const declaredPackages = new Set([
      ...Object.keys(packageJson.dependencies ?? {}),
      ...Object.keys(packageJson.peerDependencies ?? {})
    ])

    for (const file of sourceFiles) {
      const imports = collectImports(file)
      for (const entry of imports) {
        const violation = validateImport({
          declaredPackages,
          extensionDirectory,
          file,
          importEntry: entry,
          repoRoot
        })
        if (violation) {
          violations.push(violation)
        }
      }
    }
  }

  return {
    errors: violations.map(formatViolation),
    violations
  }
}

function validatePackageShape({ extensionDirectory, packageJson, packageJsonPath, repoRoot }) {
  const violations = []
  const repoPackageJsonPath = toRepoPath(repoRoot, packageJsonPath)
  const extensionId = path.basename(extensionDirectory)
  const expectedPackageName = `@openwork/extension-${extensionId}`

  if (packageJson.name !== expectedPackageName) {
    violations.push({
      file: repoPackageJsonPath,
      line: 1,
      reason: `extension package package.json must declare "name": "${expectedPackageName}"`
    })
  }

  if (packageJson.type !== "module") {
    violations.push({
      file: repoPackageJsonPath,
      line: 1,
      reason: 'extension package package.json must declare "type": "module"'
    })
  }

  if (packageJson.main !== "./main.ts") {
    violations.push({
      file: repoPackageJsonPath,
      line: 1,
      reason: 'extension package package.json must declare "main": "./main.ts"'
    })
  }

  if (packageJson.types !== "./manifest.ts") {
    violations.push({
      file: repoPackageJsonPath,
      line: 1,
      reason: 'extension package package.json must declare "types": "./manifest.ts"'
    })
  }

  for (const dependencyField of ["dependencies", "peerDependencies", "optionalDependencies"]) {
    for (const packageName of Object.keys(packageJson[dependencyField] ?? {})) {
      if (!forbiddenSourceRuntimePackages.has(packageName)) {
        continue
      }
      violations.push({
        file: repoPackageJsonPath,
        line: 1,
        reason: `extension package cannot declare source runtime package ${packageName} in ${dependencyField}`
      })
    }
  }

  for (const entry of requiredPackageEntries) {
    const absolutePath = path.join(extensionDirectory, entry.path)
    if (!pathMatchesRequiredKind(absolutePath, entry.kind)) {
      violations.push({
        file: toRepoPath(repoRoot, absolutePath),
        line: 1,
        reason: entry.reason
      })
    }
  }

  return violations
}

function validatePackageEntryIdentities({ extensionDirectory, identityContext, repoRoot }) {
  const extensionId = path.basename(extensionDirectory)
  const entries = [
    {
      file: "manifest.ts",
      functionName: "defineNativeExtensionManifest",
      label: "manifest name",
      propertyName: "name"
    },
    {
      file: "runtime.ts",
      functionName: "defineNativeExtensionRuntime",
      label: "runtime extensionName",
      propertyName: "extensionName"
    },
    {
      file: "runtime-metadata.ts",
      functionName: "defineNativeExtensionRuntimeMetadata",
      label: "runtime metadata extensionName",
      propertyName: "extensionName"
    }
  ]
  const violations = []

  for (const entry of entries) {
    const file = path.join(extensionDirectory, entry.file)
    if (!pathMatchesRequiredKind(file, "file")) {
      continue
    }

    const sourceFile = createSourceFile(file)
    const definitionObject = findCallObjectArgument(sourceFile, entry.functionName)
    if (!definitionObject) {
      continue
    }

    const expression = findObjectPropertyInitializer(definitionObject, entry.propertyName)
    const value = expression ? resolveStringExpression(expression, identityContext) : null
    if (value === extensionId) {
      continue
    }

    violations.push({
      file: toRepoPath(repoRoot, file),
      line: expression
        ? sourceFile.getLineAndCharacterOfPosition(expression.getStart(sourceFile)).line + 1
        : 1,
      reason: value
        ? `extension package ${entry.label} must be "${extensionId}", got "${value}"`
        : `extension package ${entry.label} must resolve to "${extensionId}"`
    })
  }

  return violations
}

function validateManifestAssetReferences({ extensionDirectory, identityContext, repoRoot }) {
  const file = path.join(extensionDirectory, "manifest.ts")
  if (!pathMatchesRequiredKind(file, "file")) {
    return []
  }

  const sourceFile = createSourceFile(file)
  const definitionObject = findCallObjectArgument(sourceFile, "defineNativeExtensionManifest")
  if (!definitionObject) {
    return []
  }

  const assetReferences = []
  const packageIcon = findObjectPropertyInitializer(definitionObject, "icon")
  if (packageIcon) {
    assetReferences.push({
      expression: packageIcon,
      label: "package icon"
    })
  }

  const commands = findObjectPropertyInitializer(definitionObject, "commands")
  const commandArray = commands ? unwrapExpression(commands) : null
  if (commandArray && ts.isArrayLiteralExpression(commandArray)) {
    for (const command of commandArray.elements) {
      const commandObject = unwrapExpression(command)
      if (!ts.isObjectLiteralExpression(commandObject)) {
        continue
      }

      const icon = findObjectPropertyInitializer(commandObject, "icon")
      if (!icon) {
        continue
      }

      const commandName = findObjectPropertyInitializer(commandObject, "name")
      const resolvedCommandName = commandName
        ? resolveStringExpression(commandName, identityContext)
        : null
      assetReferences.push({
        expression: icon,
        label: resolvedCommandName ? `command "${resolvedCommandName}" icon` : "command icon"
      })
    }
  }

  return assetReferences.flatMap((reference) => {
    const value = resolveStringExpression(reference.expression, identityContext)
    const line = sourceFile.getLineAndCharacterOfPosition(
      reference.expression.getStart(sourceFile)
    ).line + 1

    if (!value) {
      return [
        {
          file: toRepoPath(repoRoot, file),
          line,
          reason: `extension package ${reference.label} must resolve to a package asset path`
        }
      ]
    }

    if (!isPackageAssetPath(value)) {
      return [
        {
          file: toRepoPath(repoRoot, file),
          line,
          reason: `extension package ${reference.label} must use an assets/... package path`
        }
      ]
    }

    const assetPath = path.join(extensionDirectory, value)
    if (!pathMatchesRequiredKind(assetPath, "file")) {
      return [
        {
          file: toRepoPath(repoRoot, file),
          line,
          reason: `extension package ${reference.label} asset does not exist: ${value}`
        }
      ]
    }

    return []
  })
}

function validateRuntimeMetadataImportGraph({ extensionDirectory, repoRoot }) {
  const entryFile = path.join(extensionDirectory, "runtime-metadata.ts")
  return validateRelativeImportGraph({
    entryFile,
    extensionDirectory,
    repoRoot,
    validateEdge: validateRuntimeMetadataImportEdge
  })
}

function validateMainEntryImportGraph({ extensionDirectory, repoRoot }) {
  const entryFile = path.join(extensionDirectory, "main.ts")
  return validateRelativeImportGraph({
    entryFile,
    extensionDirectory,
    repoRoot,
    validateEdge: validateMainEntryImportEdge
  })
}

function validateRelativeImportGraph({ entryFile, extensionDirectory, repoRoot, validateEdge }) {
  if (!pathMatchesRequiredKind(entryFile, "file")) {
    return []
  }

  const violations = []
  const visited = new Set()

  const visit = (file) => {
    if (visited.has(file)) {
      return
    }
    visited.add(file)

    for (const importEntry of collectImports(file)) {
      if (!importEntry.specifier.startsWith(".")) {
        continue
      }

      const targetFile = resolveRelativeSourceFile(file, importEntry.specifier)
      if (!targetFile || !isInside(targetFile, extensionDirectory)) {
        continue
      }

      const violation = validateEdge({
        extensionDirectory,
        file,
        importEntry,
        repoRoot,
        targetFile
      })
      if (violation) {
        violations.push(violation)
        continue
      }

      visit(targetFile)
    }
  }

  visit(entryFile)
  return violations
}

function validateRuntimeMetadataImportEdge({
  extensionDirectory,
  file,
  importEntry,
  repoRoot,
  targetFile
}) {
  const targetPath = toExtensionPath(extensionDirectory, targetFile)
  if (targetPath === "runtime.ts" || targetPath === "main.ts" || targetPath.startsWith("main/")) {
    return {
      file: toRepoPath(repoRoot, file),
      import: importEntry.specifier,
      line: importEntry.line,
      reason: "runtime metadata cannot import runtime or main-process modules"
    }
  }

  if (path.extname(targetFile) === ".tsx" || path.extname(targetFile) === ".jsx") {
    return {
      file: toRepoPath(repoRoot, file),
      import: importEntry.specifier,
      line: importEntry.line,
      reason: "runtime metadata cannot import UI component modules"
    }
  }

  return null
}

function validateMainEntryImportEdge({
  extensionDirectory,
  file,
  importEntry,
  repoRoot,
  targetFile
}) {
  const targetPath = toExtensionPath(extensionDirectory, targetFile)
  if (targetPath === "runtime.ts" || targetPath === "runtime-metadata.ts") {
    return {
      file: toRepoPath(repoRoot, file),
      import: importEntry.specifier,
      line: importEntry.line,
      reason: "main entry cannot import runtime or runtime metadata modules"
    }
  }

  if (targetPath.startsWith("src/")) {
    return {
      file: toRepoPath(repoRoot, file),
      import: importEntry.specifier,
      line: importEntry.line,
      reason: "main entry cannot import command source modules"
    }
  }

  if (path.extname(targetFile) === ".tsx" || path.extname(targetFile) === ".jsx") {
    return {
      file: toRepoPath(repoRoot, file),
      import: importEntry.specifier,
      line: importEntry.line,
      reason: "main entry cannot import UI component modules"
    }
  }

  return null
}

function validatePackageCommandSurfaces({ extensionDirectory, identityContext, repoRoot }) {
  const manifestCommands = readManifestRuntimeCommandNames({
    extensionDirectory,
    identityContext,
    repoRoot
  })
  const runtimeCommands = readRuntimeCommandNames({
    extensionDirectory,
    repoRoot
  })
  const metadataCommands = readRuntimeMetadataCommandNames({
    extensionDirectory,
    identityContext,
    repoRoot
  })
  const violations = [
    ...manifestCommands.violations,
    ...runtimeCommands.violations,
    ...metadataCommands.violations
  ]

  if (!manifestCommands.names || !runtimeCommands.names || !metadataCommands.names) {
    return violations
  }

  if (metadataCommands.names.length === 0) {
    return violations
  }

  const expected = manifestCommands.names
  const runtimeMismatch = firstArrayMismatch(expected, runtimeCommands.names)
  if (runtimeMismatch) {
    violations.push({
      file: toRepoPath(repoRoot, runtimeCommands.file),
      line: runtimeMismatch.index + 1,
      reason: `extension package runtime commands must match manifest runtime commands: expected ${formatCommandList(
        expected
      )}, got ${formatCommandList(runtimeCommands.names)}`
    })
  }

  const metadataMismatch = firstArrayMismatch(expected, metadataCommands.names)
  if (metadataMismatch) {
    violations.push({
      file: toRepoPath(repoRoot, metadataCommands.file),
      line: metadataMismatch.index + 1,
      reason: `extension package runtime metadata commands must match manifest runtime commands: expected ${formatCommandList(
        expected
      )}, got ${formatCommandList(metadataCommands.names)}`
    })
  }

  return violations
}

function validatePackageMainCapabilitySurface({ extensionDirectory, identityContext, repoRoot }) {
  const manifest = readManifestCapabilityShape({
    extensionDirectory,
    identityContext,
    repoRoot
  })
  const main = readMainEntryDefinitionShape({
    extensionDirectory,
    repoRoot
  })
  const violations = [...manifest.violations, ...main.violations]

  if (!manifest.shape || !main.shape) {
    return violations
  }

  if (manifest.shape.aiToolNames.length > 0 && !main.shape.hasTools) {
    violations.push({
      file: toRepoPath(repoRoot, main.file),
      line: main.shape.definitionLine,
      reason:
        "extension package main entry must declare tools when manifest aiCapability.toolNames is non-empty"
    })
  }

  if (main.shape.hasService && !manifest.shape.hasRpc) {
    violations.push({
      file: toRepoPath(repoRoot, main.file),
      line: main.shape.serviceLine,
      reason: "extension package main entry cannot declare service unless manifest declares RPC"
    })
  }

  return violations
}

function readManifestCapabilityShape({ extensionDirectory, identityContext, repoRoot }) {
  const file = path.join(extensionDirectory, "manifest.ts")
  if (!pathMatchesRequiredKind(file, "file")) {
    return { file, shape: null, violations: [] }
  }

  const sourceFile = createSourceFile(file)
  const definitionObject = findCallObjectArgument(sourceFile, "defineNativeExtensionManifest")
  if (!definitionObject) {
    return { file, shape: null, violations: [] }
  }

  const violations = []
  const capabilities = readOptionalStaticStringArray({
    file,
    identityContext,
    objectLiteral: definitionObject,
    propertyName: "capabilities",
    repoRoot,
    sourceFile
  })
  const runtimeCapabilities = readOptionalStaticStringArray({
    file,
    identityContext,
    objectLiteral: definitionObject,
    propertyName: "runtimeCapabilities",
    repoRoot,
    sourceFile
  })
  const rpcMethods = findObjectPropertyAssignment(definitionObject, "rpcMethods")
  violations.push(...capabilities.violations, ...runtimeCapabilities.violations)

  const aiCapability = findObjectPropertyInitializer(definitionObject, "aiCapability")
  const aiCapabilityObject = aiCapability ? unwrapExpression(aiCapability) : null
  let aiToolNames = []

  if (aiCapabilityObject) {
    if (!ts.isObjectLiteralExpression(aiCapabilityObject)) {
      violations.push({
        file: toRepoPath(repoRoot, file),
        line: sourceFile.getLineAndCharacterOfPosition(aiCapability.getStart(sourceFile)).line + 1,
        reason: "extension package manifest aiCapability must be a static object"
      })
    } else {
      const toolNames = readRequiredStaticStringArray({
        file,
        identityContext,
        label: "manifest aiCapability.toolNames",
        objectLiteral: aiCapabilityObject,
        propertyName: "toolNames",
        repoRoot,
        sourceFile
      })
      violations.push(...toolNames.violations)
      aiToolNames = toolNames.values ?? []
    }
  }

  if (violations.length > 0) {
    return { file, shape: null, violations }
  }

  return {
    file,
    shape: {
      aiToolNames,
      hasRpc:
        capabilities.values.includes("rpc") ||
        runtimeCapabilities.values.includes("rpc") ||
        Boolean(rpcMethods)
    },
    violations
  }
}

function readMainEntryDefinitionShape({ extensionDirectory, repoRoot }) {
  const file = path.join(extensionDirectory, "main.ts")
  if (!pathMatchesRequiredKind(file, "file")) {
    return { file, shape: null, violations: [] }
  }

  const sourceFile = createSourceFile(file)
  const definitionObject = findCallObjectArgument(sourceFile, "defineNativeExtensionMain")
  if (!definitionObject) {
    return {
      file,
      shape: {
        definitionLine: 1,
        hasService: false,
        hasTools: false,
        serviceLine: 1
      },
      violations: []
    }
  }

  const tools = findObjectPropertyAssignment(definitionObject, "tools")
  const service = findObjectPropertyAssignment(definitionObject, "service")

  return {
    file,
    shape: {
      definitionLine: sourceFile.getLineAndCharacterOfPosition(
        definitionObject.getStart(sourceFile)
      ).line + 1,
      hasService: Boolean(service),
      hasTools: Boolean(tools),
      serviceLine: service
        ? sourceFile.getLineAndCharacterOfPosition(service.name.getStart(sourceFile)).line + 1
        : 1
    },
    violations: []
  }
}

function readOptionalStaticStringArray({
  file,
  identityContext,
  objectLiteral,
  propertyName,
  repoRoot,
  sourceFile
}) {
  const expression = findObjectPropertyInitializer(objectLiteral, propertyName)
  if (!expression) {
    return { values: [], violations: [] }
  }

  return readStaticStringArray({
    expression,
    file,
    identityContext,
    label: `manifest ${propertyName}`,
    repoRoot,
    sourceFile
  })
}

function readRequiredStaticStringArray({
  file,
  identityContext,
  label,
  objectLiteral,
  propertyName,
  repoRoot,
  sourceFile
}) {
  const expression = findObjectPropertyInitializer(objectLiteral, propertyName)
  if (!expression) {
    return {
      values: null,
      violations: [
        {
          file: toRepoPath(repoRoot, file),
          line: sourceFile.getLineAndCharacterOfPosition(objectLiteral.getStart(sourceFile)).line + 1,
          reason: `extension package ${label} must be a static array`
        }
      ]
    }
  }

  return readStaticStringArray({
    expression,
    file,
    identityContext,
    label,
    repoRoot,
    sourceFile
  })
}

function readStaticStringArray({ expression, file, identityContext, label, repoRoot, sourceFile }) {
  const arrayExpression = unwrapExpression(expression)
  if (!ts.isArrayLiteralExpression(arrayExpression)) {
    return {
      values: null,
      violations: [
        {
          file: toRepoPath(repoRoot, file),
          line: sourceFile.getLineAndCharacterOfPosition(expression.getStart(sourceFile)).line + 1,
          reason: `extension package ${label} must be a static array`
        }
      ]
    }
  }

  const values = []
  const violations = []
  for (const element of arrayExpression.elements) {
    const value = resolveStringExpression(element, identityContext)
    if (!value) {
      violations.push({
        file: toRepoPath(repoRoot, file),
        line: sourceFile.getLineAndCharacterOfPosition(element.getStart(sourceFile)).line + 1,
        reason: `extension package ${label} entries must resolve to strings`
      })
      continue
    }
    values.push(value)
  }

  return {
    values: violations.length === 0 ? values : null,
    violations
  }
}

function readManifestRuntimeCommandNames({ extensionDirectory, identityContext, repoRoot }) {
  const file = path.join(extensionDirectory, "manifest.ts")
  if (!pathMatchesRequiredKind(file, "file")) {
    return { file, names: null, violations: [] }
  }

  const sourceFile = createSourceFile(file)
  const definitionObject = findCallObjectArgument(sourceFile, "defineNativeExtensionManifest")
  const commands = definitionObject ? findObjectPropertyInitializer(definitionObject, "commands") : null
  const commandArray = commands ? unwrapExpression(commands) : null
  if (!commandArray || !ts.isArrayLiteralExpression(commandArray)) {
    return {
      file,
      names: null,
      violations: [
        {
          file: toRepoPath(repoRoot, file),
          line: commands
            ? sourceFile.getLineAndCharacterOfPosition(commands.getStart(sourceFile)).line + 1
            : 1,
          reason: "extension package manifest commands must be a static array"
        }
      ]
    }
  }

  const names = []
  const violations = []
  for (const command of commandArray.elements) {
    const commandObject = unwrapExpression(command)
    if (!ts.isObjectLiteralExpression(commandObject)) {
      violations.push({
        file: toRepoPath(repoRoot, file),
        line: sourceFile.getLineAndCharacterOfPosition(command.getStart(sourceFile)).line + 1,
        reason: "extension package manifest command entries must be static objects"
      })
      continue
    }

    if (!findObjectPropertyInitializer(commandObject, "runtime")) {
      continue
    }

    const name = findObjectPropertyInitializer(commandObject, "name")
    const resolvedName = name ? resolveStringExpression(name, identityContext) : null
    if (!resolvedName) {
      violations.push({
        file: toRepoPath(repoRoot, file),
        line: name ? sourceFile.getLineAndCharacterOfPosition(name.getStart(sourceFile)).line + 1 : 1,
        reason: "extension package manifest runtime command name must resolve to a string"
      })
      continue
    }

    names.push(resolvedName)
  }

  return {
    file,
    names: violations.length === 0 ? names : null,
    violations
  }
}

function readRuntimeCommandNames({ extensionDirectory, repoRoot }) {
  const file = path.join(extensionDirectory, "runtime.ts")
  if (!pathMatchesRequiredKind(file, "file")) {
    return { file, names: null, violations: [] }
  }

  const sourceFile = createSourceFile(file)
  const definitionObject = findCallObjectArgument(sourceFile, "defineNativeExtensionRuntime")
  const commands = definitionObject ? findObjectPropertyInitializer(definitionObject, "commands") : null
  const commandObject = commands ? unwrapExpression(commands) : null
  if (!commandObject || !ts.isObjectLiteralExpression(commandObject)) {
    return {
      file,
      names: null,
      violations: [
        {
          file: toRepoPath(repoRoot, file),
          line: commands
            ? sourceFile.getLineAndCharacterOfPosition(commands.getStart(sourceFile)).line + 1
            : 1,
          reason: "extension package runtime commands must be a static object"
        }
      ]
    }
  }

  return {
    file,
    names: commandObject.properties.flatMap((property) => {
      if (!ts.isPropertyAssignment(property)) {
        return []
      }
      const name = getObjectPropertyName(property.name)
      return name ? [name] : []
    }),
    violations: []
  }
}

function readRuntimeMetadataCommandNames({ extensionDirectory, identityContext, repoRoot }) {
  const file = path.join(extensionDirectory, "runtime-metadata.ts")
  if (!pathMatchesRequiredKind(file, "file")) {
    return { file, names: null, violations: [] }
  }

  const sourceFile = createSourceFile(file)
  const definitionObject = findCallObjectArgument(sourceFile, "defineNativeExtensionRuntimeMetadata")
  const commands = definitionObject ? findObjectPropertyInitializer(definitionObject, "commands") : null
  const commandArray = commands ? unwrapExpression(commands) : null
  if (!commandArray || !ts.isArrayLiteralExpression(commandArray)) {
    return {
      file,
      names: null,
      violations: [
        {
          file: toRepoPath(repoRoot, file),
          line: commands
            ? sourceFile.getLineAndCharacterOfPosition(commands.getStart(sourceFile)).line + 1
            : 1,
          reason: "extension package runtime metadata commands must be a static array"
        }
      ]
    }
  }

  const names = []
  const violations = []
  for (const command of commandArray.elements) {
    const commandObject = unwrapExpression(command)
    if (!ts.isObjectLiteralExpression(commandObject)) {
      violations.push({
        file: toRepoPath(repoRoot, file),
        line: sourceFile.getLineAndCharacterOfPosition(command.getStart(sourceFile)).line + 1,
        reason: "extension package runtime metadata command entries must be static objects"
      })
      continue
    }

    const name = findObjectPropertyInitializer(commandObject, "name")
    const resolvedName = name ? resolveStringExpression(name, identityContext) : null
    if (!resolvedName) {
      violations.push({
        file: toRepoPath(repoRoot, file),
        line: name ? sourceFile.getLineAndCharacterOfPosition(name.getStart(sourceFile)).line + 1 : 1,
        reason: "extension package runtime metadata command name must resolve to a string"
      })
      continue
    }

    names.push(resolvedName)
  }

  return {
    file,
    names: violations.length === 0 ? names : null,
    violations
  }
}

function validateImport({ declaredPackages, extensionDirectory, file, importEntry, repoRoot }) {
  const specifier = importEntry.specifier
  const repoFile = toRepoPath(repoRoot, file)

  if (specifier.startsWith(".")) {
    const targetBase = path.resolve(path.dirname(file), specifier)
    if (!isInside(targetBase, extensionDirectory)) {
      return {
        file: repoFile,
        import: specifier,
        line: importEntry.line,
        reason: "extension package relative imports must stay inside the package root"
      }
    }
    return null
  }

  if (specifier.startsWith("src/") || forbiddenHostAliases.some((alias) => specifier.startsWith(alias))) {
    return {
      file: repoFile,
      import: specifier,
      line: importEntry.line,
      reason: "extension package cannot import host private aliases"
    }
  }

  if (nodeBuiltins.has(specifier)) {
    if (isMainFile(extensionDirectory, file)) {
      return null
    }
    return {
      file: repoFile,
      import: specifier,
      line: importEntry.line,
      reason: "Node built-ins are main-process only in extension packages"
    }
  }

  const packageName = getPackageName(specifier)
  if (!packageName) {
    return null
  }

  const openworkTarget = forbiddenSourceRuntimePackages.get(packageName)
  if (openworkTarget) {
    return {
      file: repoFile,
      import: specifier,
      line: importEntry.line,
      reason: `extension package cannot import source runtime package ${packageName}; use ${openworkTarget}`
    }
  }

  if (mainOnlyPackages.has(packageName) && !isMainFile(extensionDirectory, file)) {
    return {
      file: repoFile,
      import: specifier,
      line: importEntry.line,
      reason: `${packageName} is main-process only in extension packages`
    }
  }

  if (allowedOpenworkPackages.has(packageName) || mainOnlyPackages.has(packageName)) {
    if (declaredPackages.has(packageName)) {
      return null
    }
    return {
      file: repoFile,
      import: specifier,
      line: importEntry.line,
      reason: `extension package must declare ${packageName} in dependencies or peerDependencies`
    }
  }

  if (!declaredPackages.has(packageName)) {
    return {
      file: repoFile,
      import: specifier,
      line: importEntry.line,
      reason: `extension package imports undeclared dependency ${packageName}`
    }
  }

  return null
}

function listExtensionPackageDirectories(extensionsRoot) {
  return fs
    .readdirSync(extensionsRoot, { withFileTypes: true })
    .map((entry) => path.join(extensionsRoot, entry.name))
    .filter((directory) => isDirectoryOrDirectorySymlink(directory))
    .filter((directory) => fs.existsSync(path.join(directory, "package.json")))
    .sort((left, right) => left.localeCompare(right))
}

function listSourceFiles(directory) {
  const entries = fs.readdirSync(directory, { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") {
        continue
      }
      files.push(...listSourceFiles(absolutePath))
      continue
    }

    if (sourceExtensions.has(path.extname(entry.name))) {
      files.push(absolutePath)
    }
  }

  return files
}

function collectImports(file) {
  const sourceFile = createSourceFile(file)
  const imports = []

  const visit = (node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      imports.push({
        line: sourceFile.getLineAndCharacterOfPosition(node.moduleSpecifier.getStart(sourceFile)).line + 1,
        specifier: node.moduleSpecifier.text
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
        line: sourceFile.getLineAndCharacterOfPosition(specifier.getStart(sourceFile)).line + 1,
        specifier: specifier.text
      })
    }

    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "require" &&
      node.arguments.length === 1 &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      const specifier = node.arguments[0]
      imports.push({
        line: sourceFile.getLineAndCharacterOfPosition(specifier.getStart(sourceFile)).line + 1,
        specifier: specifier.text
      })
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return imports
}

function resolveRelativeSourceFile(file, specifier) {
  const targetBase = path.resolve(path.dirname(file), specifier)
  const candidates = [
    targetBase,
    ...Array.from(sourceExtensions, (extension) => `${targetBase}${extension}`),
    ...Array.from(sourceExtensions, (extension) => path.join(targetBase, `index${extension}`))
  ]

  return candidates.find((candidate) => pathMatchesRequiredKind(candidate, "file")) ?? null
}

function collectPackageStringConstants(files) {
  const declarations = []
  const stringConstants = new Map()
  const objectPropertyConstants = new Map()

  for (const file of files) {
    const sourceFile = createSourceFile(file)
    const visit = (node) => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
        declarations.push({
          initializer: node.initializer,
          name: node.name.text
        })

        if (isStringExpression(node.initializer)) {
          stringConstants.set(node.name.text, node.initializer.text)
        }

        const objectInitializer = unwrapExpression(node.initializer)
        if (ts.isObjectLiteralExpression(objectInitializer)) {
          for (const property of objectInitializer.properties) {
            if (!ts.isPropertyAssignment(property) || !isStringExpression(property.initializer)) {
              continue
            }
            const propertyName = getObjectPropertyName(property.name)
            if (propertyName) {
              objectPropertyConstants.set(
                `${node.name.text}.${propertyName}`,
                property.initializer.text
              )
            }
          }
        }
      }

      ts.forEachChild(node, visit)
    }

    visit(sourceFile)
  }

  for (const declaration of declarations) {
    const value = resolveStringExpression(declaration.initializer, {
      objectPropertyConstants,
      stringConstants
    })
    if (value) {
      stringConstants.set(declaration.name, value)
    }
  }

  return {
    objectPropertyConstants,
    stringConstants
  }
}

function createSourceFile(file) {
  return ts.createSourceFile(
    file,
    fs.readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true
  )
}

function findCallObjectArgument(sourceFile, functionName) {
  let result = null
  const visit = (node) => {
    if (
      !result &&
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === functionName &&
      ts.isObjectLiteralExpression(node.arguments[0])
    ) {
      result = node.arguments[0]
      return
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return result
}

function findObjectPropertyInitializer(objectLiteral, propertyName) {
  const property = findObjectPropertyAssignment(objectLiteral, propertyName)
  return property?.initializer ?? null
}

function findObjectPropertyAssignment(objectLiteral, propertyName) {
  for (const property of objectLiteral.properties) {
    if (ts.isPropertyAssignment(property) && getObjectPropertyName(property.name) === propertyName) {
      return property
    }

    if (ts.isShorthandPropertyAssignment(property) && property.name.text === propertyName) {
      return property
    }
  }
  return null
}

function resolveStringExpression(expression, identityContext) {
  const unwrappedExpression = unwrapExpression(expression)

  if (isStringExpression(unwrappedExpression)) {
    return unwrappedExpression.text
  }

  if (ts.isIdentifier(unwrappedExpression)) {
    return identityContext.stringConstants.get(unwrappedExpression.text) ?? null
  }

  if (
    ts.isPropertyAccessExpression(unwrappedExpression) &&
    ts.isIdentifier(unwrappedExpression.expression)
  ) {
    return (
      identityContext.objectPropertyConstants.get(
        `${unwrappedExpression.expression.text}.${unwrappedExpression.name.text}`
      ) ?? null
    )
  }

  return null
}

function unwrapExpression(expression) {
  if (
    ts.isAsExpression(expression) ||
    ts.isSatisfiesExpression(expression) ||
    ts.isParenthesizedExpression(expression)
  ) {
    return unwrapExpression(expression.expression)
  }

  return expression
}

function isStringExpression(expression) {
  return ts.isStringLiteral(expression) || expression.kind === ts.SyntaxKind.NoSubstitutionTemplateLiteral
}

function isPackageAssetPath(value) {
  return !value.startsWith("/") && !value.includes("..") && value.startsWith("assets/")
}

function firstArrayMismatch(expected, actual) {
  const length = Math.max(expected.length, actual.length)
  for (let index = 0; index < length; index += 1) {
    if (expected[index] !== actual[index]) {
      return { index }
    }
  }
  return null
}

function formatCommandList(commands) {
  return `[${commands.map((command) => JSON.stringify(command)).join(", ")}]`
}

function getObjectPropertyName(name) {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text
  }
  return null
}

function getPackageName(specifier) {
  if (specifier.startsWith("@")) {
    const [scope, name] = specifier.split("/")
    return scope && name ? `${scope}/${name}` : null
  }
  return specifier.split("/")[0] || null
}

function pathMatchesRequiredKind(filePath, kind) {
  try {
    const stats = fs.statSync(filePath)
    return kind === "directory" ? stats.isDirectory() : stats.isFile()
  } catch {
    return false
  }
}

function isDirectoryOrDirectorySymlink(directory) {
  try {
    return fs.statSync(directory).isDirectory()
  } catch {
    return false
  }
}

function isMainFile(extensionDirectory, file) {
  const relative = path.relative(extensionDirectory, file).split(path.sep).join("/")
  return relative === "main.ts" || relative.startsWith("main/")
}

function toExtensionPath(extensionDirectory, file) {
  return path.relative(extensionDirectory, file).split(path.sep).join("/")
}

function isInside(candidate, directory) {
  const relative = path.relative(directory, candidate)
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
}

function toRepoPath(repoRoot, file) {
  return path.relative(repoRoot, file).split(path.sep).join("/")
}

function formatViolation(violation) {
  if (!violation.import) {
    return `${violation.file}:${violation.line} ${violation.reason}`
  }

  return `${violation.file}:${violation.line} imports ${JSON.stringify(
    violation.import
  )}: ${violation.reason}`
}
