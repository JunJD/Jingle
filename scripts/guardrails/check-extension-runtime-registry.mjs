import path from "node:path"
import ts from "typescript"
import {
  fileExists,
  formatViolations,
  isInstallableExtensionDirectory,
  listBuiltInRegistryExtensionDirectories,
  loadNativeExtensionManifest,
  parseSourceFile,
  repoRoot,
  toRepoPath
} from "./lib/architecture-guardrails.mjs"

const violations = []
const runtimeRegistryPath = path.join(repoRoot, "src/extensions/runtime-packages.ts")

if (!fileExists(runtimeRegistryPath)) {
  violations.push({
    file: "src/extensions/runtime-packages.ts",
    reason: "缺少 package-level runtime registry"
  })
}

const runtimeRegistryExtensionIds = fileExists(runtimeRegistryPath)
  ? listRuntimeRegistryExtensionIds(runtimeRegistryPath)
  : new Set()
const extensionDirectories = listBuiltInRegistryExtensionDirectories()
const directoryExtensionIds = new Set(extensionDirectories.map((directory) => directory.name))

for (const extensionDirectory of extensionDirectories) {
  const isInstallable = isInstallableExtensionDirectory(extensionDirectory)
  const manifest = loadNativeExtensionManifest(extensionDirectory)
  const runtimeCommands = manifest.commands.filter((command) => command.runtime)
  const runtimePath = path.join(extensionDirectory.absolutePath, "runtime.ts")

  if (!isInstallable && !runtimeRegistryExtensionIds.has(extensionDirectory.name)) {
    violations.push({
      file: "src/extensions/runtime-packages.ts",
      reason: `extension "${extensionDirectory.name}" 没有被 package-level runtime registry 收录`
    })
  }

  if (isInstallable && runtimeRegistryExtensionIds.has(extensionDirectory.name)) {
    violations.push({
      file: "src/extensions/runtime-packages.ts",
      reason: `installable extension "${extensionDirectory.name}" 不应被 built-in package-level runtime registry 收录`
    })
  }

  if (!fileExists(runtimePath)) {
    violations.push({
      file: `${extensionDirectory.repoPath}/runtime.ts`,
      reason: "extension 缺少 package-level runtime entry"
    })
    continue
  }

  let runtimeEntry
  try {
    runtimeEntry = parseRuntimeEntry(extensionDirectory, runtimePath)
  } catch (error) {
    violations.push({
      file: `${extensionDirectory.repoPath}/runtime.ts`,
      reason: error instanceof Error ? error.message : String(error)
    })
    continue
  }

  if (runtimeEntry.extensionName !== manifest.name) {
    violations.push({
      file: `${extensionDirectory.repoPath}/runtime.ts`,
      reason: `runtime entry extensionName "${runtimeEntry.extensionName}" 与 manifest.name "${manifest.name}" 不一致`
    })
  }

  for (const command of runtimeCommands) {
    const runtimeCommand = runtimeEntry.commands.get(command.name)
    if (!runtimeCommand) {
      violations.push({
        file: `${extensionDirectory.repoPath}/runtime.ts`,
        reason: `manifest runtime command "${manifest.name}:${command.name}" 没有 package runtime entry`
      })
      continue
    }

    if (runtimeCommand.mode !== command.mode) {
      violations.push({
        file: `${extensionDirectory.repoPath}/runtime.ts`,
        reason: `runtime command "${manifest.name}:${command.name}" mode 是 "${runtimeCommand.mode}"，manifest mode 是 "${command.mode}"`
      })
    }

    checkRuntimeCommandShape(extensionDirectory, manifest.name, command.name, runtimeCommand)
  }

  for (const [commandName, runtimeCommand] of runtimeEntry.commands) {
    const manifestCommand = manifest.commands.find((command) => command.name === commandName)
    if (!manifestCommand) {
      violations.push({
        file: `${extensionDirectory.repoPath}/runtime.ts`,
        reason: `package runtime entry 导出了 manifest 不存在的 command "${manifest.name}:${commandName}"`
      })
      continue
    }

    if (!manifestCommand.runtime) {
      violations.push({
        file: `${extensionDirectory.repoPath}/runtime.ts`,
        reason: `package runtime entry 导出了未声明 runtime 的 manifest command "${manifest.name}:${commandName}"`
      })
      continue
    }

    checkRuntimeCommandShape(extensionDirectory, manifest.name, commandName, runtimeCommand)
  }
}

for (const extensionId of runtimeRegistryExtensionIds) {
  if (!directoryExtensionIds.has(extensionId)) {
    violations.push({
      file: "src/extensions/runtime-packages.ts",
      reason: `package-level runtime registry 收录了不存在的 extension "${extensionId}"`
    })
  }
}

if (violations.length === 0) {
  console.log("extension runtime registry check passed")
  process.exit(0)
}

console.error(formatViolations("extension runtime registry check", violations))
process.exit(1)

function listRuntimeRegistryExtensionIds(absolutePath) {
  const sourceFile = parseSourceFile(absolutePath)
  const importedExtensionIds = new Map()
  const extensionIds = new Set()

  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
      continue
    }

    const match = statement.moduleSpecifier.text.match(
      /^(?:\.\/|\.\.\/\.\.\/extensions\/)([^/]+)\/runtime$/
    )
    if (!match) {
      continue
    }

    const namedBindings = statement.importClause?.namedBindings
    if (!namedBindings || !ts.isNamedImports(namedBindings)) {
      continue
    }

    for (const element of namedBindings.elements) {
      importedExtensionIds.set(element.name.text, match[1])
    }
  }

  const initializer = getExportedConstInitializer(sourceFile, "nativeExtensionRuntimePackages")
  const registryArray = unwrapArrayInitializer(initializer)
  if (!registryArray) {
    violations.push({
      file: toRepoPath(absolutePath),
      reason: "nativeExtensionRuntimePackages 必须是 package runtime entry 数组"
    })
    return extensionIds
  }

  for (const element of registryArray.elements) {
    if (!ts.isIdentifier(element)) {
      violations.push({
        file: toRepoPath(absolutePath),
        reason: "nativeExtensionRuntimePackages 只能收录 imported runtime entry identifier"
      })
      continue
    }

    const extensionId = importedExtensionIds.get(element.text)
    if (!extensionId) {
      violations.push({
        file: toRepoPath(absolutePath),
        reason: `runtime registry entry "${element.text}" 不是来自 ./<extension>/runtime 的 import`
      })
      continue
    }

    extensionIds.add(extensionId)
  }

  return extensionIds
}

function parseRuntimeEntry(extensionDirectory, absolutePath) {
  const sourceFile = parseSourceFile(absolutePath)
  const runtimeObject = findExportedDefineRuntimeObject(sourceFile, absolutePath)
  const extensionName = readStringProperty(runtimeObject, "extensionName")
  const commandsObject = readObjectProperty(runtimeObject, "commands")

  if (!extensionName) {
    throw new Error("runtime entry 必须声明 string literal extensionName")
  }

  if (!commandsObject) {
    throw new Error("runtime entry 必须声明 commands object")
  }

  const commands = new Map()

  for (const property of commandsObject.properties) {
    if (!ts.isPropertyAssignment(property)) {
      throw new Error("runtime entry commands 只能使用 property assignment")
    }

    const commandName = getPropertyNameText(property.name)
    if (!commandName) {
      throw new Error("runtime entry command key 必须是 identifier 或 string literal")
    }

    if (commands.has(commandName)) {
      violations.push({
        file: `${extensionDirectory.repoPath}/runtime.ts`,
        reason: `runtime entry 重复声明 command "${extensionName}:${commandName}"`
      })
      continue
    }

    if (!ts.isObjectLiteralExpression(property.initializer)) {
      throw new Error(`runtime entry command "${commandName}" 必须是 object literal`)
    }

    const mode = readStringProperty(property.initializer, "mode")
    commands.set(commandName, {
      hasComponent: hasObjectProperty(property.initializer, "Component"),
      hasRun: hasObjectProperty(property.initializer, "run"),
      mode
    })
  }

  return {
    commands,
    extensionName
  }
}

function checkRuntimeCommandShape(extensionDirectory, extensionName, commandName, runtimeCommand) {
  if (runtimeCommand.mode === "view") {
    if (!runtimeCommand.hasComponent) {
      violations.push({
        file: `${extensionDirectory.repoPath}/runtime.ts`,
        reason: `view command "${extensionName}:${commandName}" 缺少 Component`
      })
    }
    return
  }

  if (runtimeCommand.mode === "no-view") {
    if (!runtimeCommand.hasRun) {
      violations.push({
        file: `${extensionDirectory.repoPath}/runtime.ts`,
        reason: `no-view command "${extensionName}:${commandName}" 缺少 run`
      })
    }
    return
  }

  if (runtimeCommand.mode === "menu-bar") {
    if (!runtimeCommand.hasComponent) {
      violations.push({
        file: `${extensionDirectory.repoPath}/runtime.ts`,
        reason: `menu-bar command "${extensionName}:${commandName}" 缺少 Component`
      })
    }
    return
  }

  violations.push({
    file: `${extensionDirectory.repoPath}/runtime.ts`,
    reason: `runtime command "${extensionName}:${commandName}" mode "${runtimeCommand.mode}" 不受支持`
  })
}

function findExportedDefineRuntimeObject(sourceFile, absolutePath) {
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) {
      continue
    }

    if (!statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) {
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
      if (!argument || !ts.isObjectLiteralExpression(argument)) {
        throw new Error("defineNativeExtensionRuntime(...) 必须接收 object literal")
      }

      return argument
    }
  }

  throw new Error(`${toRepoPath(absolutePath)} 必须 export defineNativeExtensionRuntime(...)`)
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

function readStringProperty(objectLiteral, propertyName) {
  const initializer = getObjectPropertyInitializer(objectLiteral, propertyName)
  if (!initializer || !ts.isStringLiteral(initializer)) {
    return null
  }

  return initializer.text
}

function readObjectProperty(objectLiteral, propertyName) {
  const initializer = getObjectPropertyInitializer(objectLiteral, propertyName)
  if (!initializer || !ts.isObjectLiteralExpression(initializer)) {
    return null
  }

  return initializer
}

function hasObjectProperty(objectLiteral, propertyName) {
  return !!getObjectPropertyInitializer(objectLiteral, propertyName)
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
