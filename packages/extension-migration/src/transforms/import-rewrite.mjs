import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const ts = require("typescript")

const RUNTIME_IMPORT_REWRITES = new Map([
  ["@raycast/api", "@openwork/extension-api"],
  ["@raycast/utils", "@openwork/extension-utils"]
])

export function rewriteRaycastRuntimeImports(sourceText, filePath = "source.ts") {
  const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true)
  const replacements = []

  function recordModuleSpecifier(moduleSpecifier) {
    if (!isStaticStringLiteral(moduleSpecifier)) {
      return
    }

    const target = RUNTIME_IMPORT_REWRITES.get(moduleSpecifier.text)
    if (!target) {
      return
    }

    replacements.push({
      end: moduleSpecifier.getEnd() - 1,
      start: moduleSpecifier.getStart(sourceFile) + 1,
      text: target
    })
  }

  function visit(node) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
      recordModuleSpecifier(node.moduleSpecifier)
    }

    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1
    ) {
      recordModuleSpecifier(node.arguments[0])
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return applyTextReplacements(sourceText, replacements)
}

function isStaticStringLiteral(node) {
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
}

function applyTextReplacements(sourceText, replacements) {
  if (replacements.length === 0) {
    return sourceText
  }

  return replacements
    .slice()
    .sort((left, right) => right.start - left.start)
    .reduce(
      (current, replacement) =>
        `${current.slice(0, replacement.start)}${replacement.text}${current.slice(
          replacement.end
        )}`,
      sourceText
    )
}
