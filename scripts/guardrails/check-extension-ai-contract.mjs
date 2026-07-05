import path from "node:path"
import ts from "typescript"
import {
  collectImports,
  formatViolations,
  isUnder,
  listBuiltInRegistryExtensionDirectories,
  listSourceFiles,
  loadNativeExtensionManifest,
  parseSourceFile,
  resolveImportPath,
  toRepoPath
} from "./lib/architecture-guardrails.mjs"

const violations = []

for (const extensionDirectory of listBuiltInRegistryExtensionDirectories()) {
  const manifest = loadNativeExtensionManifest(extensionDirectory)
  const sourceFiles = listSourceFiles(extensionDirectory.absolutePath)

  if (manifest.name === "translate") {
    checkTranslateImports(sourceFiles)
  }

  if (!extensionUsesAiHostRequest(sourceFiles)) {
    continue
  }

  if (!manifest.runtimeCapabilities?.includes("ai")) {
    violations.push({
      file: `${extensionDirectory.repoPath}/manifest.ts`,
      reason: `extension "${manifest.name}" uses the AI host request contract but does not declare runtimeCapabilities: ["ai"]`
    })
  }
}

if (violations.length === 0) {
  console.log("extension AI contract check passed")
  process.exit(0)
}

console.error(formatViolations("extension AI contract check", violations))
process.exit(1)

function checkTranslateImports(sourceFiles) {
  for (const absoluteFilePath of sourceFiles) {
    const repoFilePath = toRepoPath(absoluteFilePath)

    for (const entry of collectBoundaryImports(absoluteFilePath)) {
      const resolved = resolveImportPath(absoluteFilePath, entry.specifier)
      if (!resolved) {
        continue
      }

      const repoTargetPath = toRepoPath(path.resolve(resolved))
      if (!isUnder(repoTargetPath, "src/main/") && !isUnder(repoTargetPath, "src/renderer/")) {
        continue
      }

      violations.push({
        file: repoFilePath,
        import: entry.specifier,
        line: entry.line,
        reason: "translate extension must use public extension runtime contracts instead of main/renderer internals",
        target: repoTargetPath
      })
    }
  }
}

function collectBoundaryImports(absoluteFilePath) {
  return [...collectImports(absoluteFilePath), ...collectImportTypeSpecifiers(absoluteFilePath)]
}

function collectImportTypeSpecifiers(absoluteFilePath) {
  const sourceFile = parseSourceFile(absoluteFilePath)
  const imports = []

  const visit = (node) => {
    if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteral(node.argument.literal)
    ) {
      imports.push({
        specifier: node.argument.literal.text,
        line:
          sourceFile.getLineAndCharacterOfPosition(
            node.argument.literal.getStart(sourceFile)
          ).line + 1
      })
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return imports
}

function extensionUsesAiHostRequest(sourceFiles) {
  return sourceFiles.some((absoluteFilePath) => sourceFileUsesAiHostRequest(absoluteFilePath))
}

function sourceFileUsesAiHostRequest(absoluteFilePath) {
  const sourceFile = parseSourceFile(absoluteFilePath)
  let usesAiHostRequest = false

  const visit = (node) => {
    if (usesAiHostRequest) {
      return
    }

    if (
      ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "AI" &&
      node.name.text === "ask"
    ) {
      usesAiHostRequest = true
      return
    }

    if (
      ts.isPropertyAssignment(node) &&
      isPropertyName(node.name, "capability") &&
      ts.isStringLiteral(node.initializer) &&
      node.initializer.text === "ai"
    ) {
      usesAiHostRequest = true
      return
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return usesAiHostRequest
}

function isPropertyName(name, expected) {
  return (
    (ts.isIdentifier(name) && name.text === expected) ||
    (ts.isStringLiteral(name) && name.text === expected)
  )
}
