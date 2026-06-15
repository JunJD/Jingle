/* eslint-disable @typescript-eslint/explicit-function-return-type */
import path from "node:path"
import ts from "typescript"
import {
  collectImports,
  fileExists,
  formatViolations,
  isExact,
  isUnder,
  listBuiltInRegistryExtensionDirectories,
  listSourceFiles,
  loadNativeExtensionManifest,
  parseSourceFile,
  repoRoot,
  resolveExtensionCommandFile,
  resolveImportPath,
  srcRoot,
  toRepoPath
} from "./lib/architecture-guardrails.mjs"

const violations = []
const runtimeApiPath = path.resolve(path.join(srcRoot, "extensions/runtime-api.ts"))

function isRendererImportOwner(repoFilePath) {
  return (
    isUnder(repoFilePath, "src/renderer/") ||
    isExact(repoFilePath, "src/extensions/index.ts") ||
    isExact(repoFilePath, "src/extensions/runtime-metadata.ts") ||
    isExact(repoFilePath, "src/extensions/runtime-metadata-packages.ts") ||
    /^src\/extensions\/[^/]+\/manifest\.ts$/.test(repoFilePath) ||
    /^src\/extensions\/[^/]+\/runtime-metadata\.ts$/.test(repoFilePath) ||
    /^extensions\/[^/]+\/manifest\.ts$/.test(repoFilePath) ||
    /^extensions\/[^/]+\/runtime-metadata\.ts$/.test(repoFilePath)
  )
}

const runtimeCommandFiles = new Map()

for (const extensionDirectory of listBuiltInRegistryExtensionDirectories()) {
  const manifest = loadNativeExtensionManifest(extensionDirectory)
  for (const command of manifest.commands.filter((entry) => entry.runtime)) {
    const commandFile = resolveExtensionCommandFile(extensionDirectory, command.name)
    if (!commandFile) {
      violations.push({
        file: `${extensionDirectory.repoPath}/manifest.ts`,
        reason: `runtime command "${manifest.name}:${command.name}" does not resolve to an extension command file`
      })
      continue
    }

    runtimeCommandFiles.set(path.resolve(commandFile), {
      commandName: command.name,
      extensionName: manifest.name
    })
  }

  const runtimeEntryPath = path.join(extensionDirectory.absolutePath, "runtime.ts")
  if (!fileExists(runtimeEntryPath)) {
    continue
  }

  for (const commandFile of listRuntimeEntryCommandFiles(runtimeEntryPath)) {
    runtimeCommandFiles.set(path.resolve(commandFile.absolutePath), {
      commandName: commandFile.commandName,
      extensionName: manifest.name
    })
  }
}

if (runtimeCommandFiles.size > 0) {
  for (const rootFilePath of listRendererReachableRootFiles()) {
    walkRendererImportGraph(rootFilePath, rootFilePath, [])
  }
}

if (violations.length === 0) {
  console.log("runtime command renderer import check passed")
  process.exit(0)
}

console.error(formatViolations("runtime command renderer import check", violations))
process.exit(1)

function listRendererReachableRootFiles() {
  return [
    ...listSourceFiles(srcRoot),
    ...listSourceFiles(path.join(repoRoot, "extensions"))
  ].filter((absoluteFilePath) => isRendererImportOwner(toRepoPath(absoluteFilePath)))
}

function walkRendererImportGraph(rootFilePath, currentFilePath, importStack, visited = new Set()) {
  const currentResolvedPath = path.resolve(currentFilePath)
  if (visited.has(currentResolvedPath)) {
    return
  }
  visited.add(currentResolvedPath)

  for (const entry of collectImports(currentResolvedPath)) {
    const resolved = resolveImportPath(currentResolvedPath, entry.specifier)
    if (!resolved) {
      continue
    }

    const resolvedPath = path.resolve(resolved)
    const nextStack = [...importStack, toRepoPath(currentResolvedPath)]
    const command = runtimeCommandFiles.get(resolvedPath)
    if (command) {
      violations.push({
        file: toRepoPath(currentResolvedPath),
        import: entry.specifier,
        line: entry.line,
        reason: `runtime command "${command.extensionName}:${command.commandName}" must not be reachable from renderer code via ${formatImportStack(rootFilePath, nextStack)}`,
        target: toRepoPath(resolvedPath)
      })
      continue
    }

    if (resolvedPath === runtimeApiPath) {
      violations.push({
        file: toRepoPath(currentResolvedPath),
        import: entry.specifier,
        line: entry.line,
        reason: `extension runtime API must not be reachable from renderer code via ${formatImportStack(rootFilePath, nextStack)}`,
        target: toRepoPath(resolvedPath)
      })
      continue
    }

    if (!isUnder(toRepoPath(resolvedPath), "src/")) {
      continue
    }

    walkRendererImportGraph(rootFilePath, resolvedPath, nextStack, visited)
  }
}

function listRuntimeEntryCommandFiles(runtimeEntryPath) {
  const sourceFile = parseSourceFile(runtimeEntryPath)
  const importedFilesByBinding = collectImportedFilesByBinding(runtimeEntryPath, sourceFile)
  const runtimeObject = findDefineRuntimeObject(sourceFile)
  if (!runtimeObject) {
    return []
  }

  const commandsObject = readObjectProperty(runtimeObject, "commands")
  if (!commandsObject) {
    return []
  }

  const files = []
  for (const property of commandsObject.properties) {
    if (!ts.isPropertyAssignment(property) || !ts.isObjectLiteralExpression(property.initializer)) {
      continue
    }

    const commandName = getPropertyNameText(property.name)
    if (!commandName) {
      continue
    }

    for (const runtimePropertyName of ["Component", "run"]) {
      const initializer = getObjectPropertyInitializer(property.initializer, runtimePropertyName)
      if (!initializer || !ts.isIdentifier(initializer)) {
        continue
      }

      const commandFilePath = importedFilesByBinding.get(initializer.text)
      if (!commandFilePath) {
        continue
      }

      files.push({
        absolutePath: commandFilePath,
        commandName
      })
    }
  }

  return files
}

function collectImportedFilesByBinding(fromFilePath, sourceFile) {
  const importedFilesByBinding = new Map()

  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
      continue
    }

    const resolved = resolveImportPath(fromFilePath, statement.moduleSpecifier.text)
    if (!resolved) {
      continue
    }

    const resolvedPath = path.resolve(resolved)
    const repoResolvedPath = toRepoPath(resolvedPath)
    if (!isUnder(repoResolvedPath, "src/extensions/") && !isUnder(repoResolvedPath, "extensions/")) {
      continue
    }

    const importClause = statement.importClause
    if (!importClause) {
      continue
    }

    if (importClause.name) {
      importedFilesByBinding.set(importClause.name.text, resolvedPath)
    }

    const namedBindings = importClause.namedBindings
    if (!namedBindings || !ts.isNamedImports(namedBindings)) {
      continue
    }

    for (const element of namedBindings.elements) {
      importedFilesByBinding.set(element.name.text, resolvedPath)
    }
  }

  return importedFilesByBinding
}

function findDefineRuntimeObject(sourceFile) {
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
        initializer.expression.text !== "defineNativeExtensionRuntime"
      ) {
        continue
      }

      const argument = initializer.arguments[0]
      if (argument && ts.isObjectLiteralExpression(argument)) {
        return argument
      }
    }
  }

  return null
}

function readObjectProperty(objectLiteral, propertyName) {
  const initializer = getObjectPropertyInitializer(objectLiteral, propertyName)
  if (!initializer || !ts.isObjectLiteralExpression(initializer)) {
    return null
  }

  return initializer
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

function formatImportStack(rootFilePath, importStack) {
  const rootRepoPath = toRepoPath(path.resolve(rootFilePath))
  const stack = importStack[0] === rootRepoPath ? importStack : [rootRepoPath, ...importStack]
  return stack.join(" -> ")
}
