import path from "node:path"
import ts from "typescript"
import {
  formatViolations,
  listBuiltInRegistryExtensionDirectories,
  listSourceFiles,
  loadNativeExtensionManifest,
  parseSourceFile,
  toRepoPath
} from "./lib/architecture-guardrails.mjs"

const runtimeApiCapabilityByExport = new Map([
  ["Clipboard", "clipboard"],
  ["confirmAlert", "dialog"],
  ["createNativeExtensionClient", "rpc"],
  ["closeMainWindow", "navigation"],
  ["LocalStorage", "storage"],
  ["openExternal", "shell"],
  ["openNativeExtensionSettings", "settings"],
  ["showToast", "toast"],
  ["useExtensionStorageState", "storage"],
  ["useNativeCommandPreferences", "preferences"],
  ["useNativeExtensionNavigation", "navigation"],
  ["writeClipboardText", "clipboard"]
])

const hostCapabilities = new Set([
  "ai",
  "clipboard",
  "dialog",
  "navigation",
  "preferences",
  "rpc",
  "scheduler",
  "settings",
  "shell",
  "storage",
  "toast"
])

const violations = []

for (const extensionDirectory of listBuiltInRegistryExtensionDirectories()) {
  const manifest = loadNativeExtensionManifest(extensionDirectory)
  const runtimeCommands = manifest.commands.filter((command) => command.runtime)
  const requiredCapabilities = new Map()

  if (runtimeCommands.length > 0) {
    requiredCapabilities.set("preferences", {
      file: `${extensionDirectory.repoPath}/manifest.ts`,
      line: null,
      reason: "runtime launch resolves extension and command preferences before rendering"
    })
  }

  for (const absoluteFilePath of listRuntimeSourceFiles(extensionDirectory.absolutePath)) {
    for (const usage of collectRuntimeCapabilityUsages(absoluteFilePath)) {
      if (!requiredCapabilities.has(usage.capability)) {
        requiredCapabilities.set(usage.capability, usage)
      }
    }
  }

  const declaredCapabilities = new Set(manifest.runtimeCapabilities ?? [])

  for (const [capability, usage] of requiredCapabilities) {
    if (declaredCapabilities.has(capability)) {
      continue
    }

    violations.push({
      file: `${extensionDirectory.repoPath}/manifest.ts`,
      line: usage.line,
      reason: `extension "${manifest.name}" uses runtime host capability "${capability}" but does not declare it in runtimeCapabilities`,
      target: usage.file
    })
  }
}

if (violations.length === 0) {
  console.log("extension runtime capabilities check passed")
  process.exit(0)
}

console.error(formatViolations("extension runtime capabilities check", violations))
process.exit(1)

function listRuntimeSourceFiles(extensionAbsolutePath) {
  return listSourceFiles(extensionAbsolutePath).filter((absoluteFilePath) => {
    const relativePath = path.relative(extensionAbsolutePath, absoluteFilePath)
    return !relativePath.split(path.sep).includes("main")
  })
}

function collectRuntimeCapabilityUsages(absoluteFilePath) {
  const sourceFile = parseSourceFile(absoluteFilePath)
  const runtimeApiLocals = collectRuntimeApiLocals(sourceFile)
  const usages = []

  const visit = (node) => {
    const capabilityFromRequest = readDirectHostRequestCapability(node)
    if (capabilityFromRequest) {
      usages.push(toUsage(sourceFile, absoluteFilePath, node, capabilityFromRequest))
    }

    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const importedExportName = runtimeApiLocals.get(node.expression.text)
      const capability = importedExportName
        ? runtimeApiCapabilityByExport.get(importedExportName)
        : null

      if (capability) {
        usages.push(toUsage(sourceFile, absoluteFilePath, node, capability))
      }
    }

    if (
      ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      runtimeApiLocals.get(node.expression.text) === "AI" &&
      node.name.text === "ask"
    ) {
      usages.push(toUsage(sourceFile, absoluteFilePath, node, "ai"))
    }

    if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)) {
      const importedExportName = runtimeApiLocals.get(node.expression.text)
      const importedExportCapability = importedExportName
        ? runtimeApiCapabilityByExport.get(importedExportName)
        : null

      if (importedExportCapability) {
        usages.push(toUsage(sourceFile, absoluteFilePath, node, importedExportCapability))
      }

      const actionCapability = getActionCapability(
        runtimeApiLocals,
        node.expression.text,
        node.name.text
      )
      if (actionCapability) {
        usages.push(toUsage(sourceFile, absoluteFilePath, node, actionCapability))
      }
    }

    if (ts.isJsxOpeningLikeElement(node)) {
      const actionCapability = getActionTagCapability(sourceFile, runtimeApiLocals, node)
      if (actionCapability) {
        usages.push(toUsage(sourceFile, absoluteFilePath, node, actionCapability))
      }
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return usages
}

function collectRuntimeApiLocals(sourceFile) {
  const locals = new Map()

  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
      continue
    }

    if (
      !statement.moduleSpecifier.text.endsWith("runtime-api") &&
      statement.moduleSpecifier.text !== "@jingle/extension-api"
    ) {
      continue
    }

    const namedBindings = statement.importClause?.namedBindings
    if (!namedBindings || !ts.isNamedImports(namedBindings)) {
      continue
    }

    for (const element of namedBindings.elements) {
      const exportName = element.propertyName?.text ?? element.name.text
      locals.set(element.name.text, exportName)
    }
  }

  return locals
}

function readDirectHostRequestCapability(node) {
  if (!ts.isPropertyAssignment(node)) {
    return null
  }

  if (!isPropertyName(node.name, "capability")) {
    return null
  }

  if (!ts.isStringLiteral(node.initializer)) {
    return null
  }

  return hostCapabilities.has(node.initializer.text) ? node.initializer.text : null
}

function getActionCapability(runtimeApiLocals, localName, propertyName) {
  if (runtimeApiLocals.get(localName) !== "Action") {
    return null
  }

  if (propertyName === "OpenInBrowser") {
    return "shell"
  }

  if (propertyName === "CopyToClipboard") {
    return "clipboard"
  }

  if (propertyName === "Push") {
    return "navigation"
  }

  return null
}

function getActionTagCapability(sourceFile, runtimeApiLocals, node) {
  const tagName = node.tagName.getText(sourceFile)
  const [localName, propertyName] = tagName.split(".")

  if (!localName || !propertyName) {
    return null
  }

  return getActionCapability(runtimeApiLocals, localName, propertyName)
}

function isPropertyName(name, expected) {
  return (
    (ts.isIdentifier(name) && name.text === expected) ||
    (ts.isStringLiteral(name) && name.text === expected)
  )
}

function toUsage(sourceFile, absoluteFilePath, node, capability) {
  return {
    capability,
    file: toRepoPath(absoluteFilePath),
    line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1
  }
}
