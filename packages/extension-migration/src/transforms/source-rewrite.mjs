import { createRequire } from "node:module"
import { rewriteRaycastRuntimeImports } from "./import-rewrite.mjs"
import { getApplicableTransforms, knownExtensionTransforms } from "./known-extensions/index.mjs"

const require = createRequire(import.meta.url)
const ts = require("typescript")
const NAVIGATION_COMPONENTS = new Set(["Detail", "Form", "List"])

export function rewriteSourceForJingle(sourceText, filePath, target, options = {}) {
  const rewrittenSource = rewriteGenericSourceForJingle(sourceText, filePath, target)
  const transformContext = {
    filePath,
    sourceFiles: options.sourceFiles,
    sourceText: rewrittenSource,
    target
  }
  const transforms = getApplicableTransforms(
    transformContext,
    options.knownTransforms ?? knownExtensionTransforms
  )
  const knownExtensionResult = runKnownExtensionTransforms(
    rewrittenSource,
    filePath,
    target,
    transforms,
    {
      sourceFiles: options.sourceFiles
    }
  )

  return {
    diagnostics: knownExtensionResult.diagnostics,
    sourceText: ensureReactRuntimeImport(
      ensureExtensionRuntimeNavigationTitles(
        knownExtensionResult.sourceText,
        filePath,
        options.navigationTitle
      ),
      filePath
    )
  }
}

export function ensureExtensionRuntimeNavigationTitles(sourceText, filePath, navigationTitle) {
  if (!filePath.endsWith(".tsx")) {
    return sourceText
  }

  const sourceFile = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  )
  const localComponents = new Set()
  const namespaceImports = new Set()

  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== "@jingle/extension-api"
    ) {
      continue
    }
    const bindings = statement.importClause?.namedBindings
    if (ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) {
        const importedName = element.propertyName?.text ?? element.name.text
        if (NAVIGATION_COMPONENTS.has(importedName)) {
          localComponents.add(element.name.text)
        }
      }
    } else if (ts.isNamespaceImport(bindings)) {
      namespaceImports.add(bindings.name.text)
    }
  }

  const insertions = []
  const visit = (node) => {
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      isNavigationComponentTag(node.tagName, localComponents, namespaceImports) &&
      !node.attributes.properties.some(
        (property) => ts.isJsxAttribute(property) && property.name.text === "navigationTitle"
      )
    ) {
      insertions.push(node.tagName.end)
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)

  if (insertions.length === 0) {
    return sourceText
  }
  if (typeof navigationTitle !== "string" || navigationTitle.trim().length === 0) {
    throw new Error(`Missing navigation title while rewriting ${filePath}.`)
  }

  const attribute = ` navigationTitle={${JSON.stringify(navigationTitle)}}`
  return insertions
    .sort((left, right) => right - left)
    .reduce(
      (currentSource, position) =>
        `${currentSource.slice(0, position)}${attribute}${currentSource.slice(position)}`,
      sourceText
    )
}

function isNavigationComponentTag(tagName, localComponents, namespaceImports) {
  if (ts.isIdentifier(tagName)) {
    return localComponents.has(tagName.text)
  }
  return (
    ts.isPropertyAccessExpression(tagName) &&
    ts.isIdentifier(tagName.expression) &&
    namespaceImports.has(tagName.expression.text) &&
    NAVIGATION_COMPONENTS.has(tagName.name.text)
  )
}

export function rewriteGenericSourceForJingle(sourceText, filePath, target) {
  const rewrittenSource = rewriteRaycastRuntimeImports(
    rewriteRaycastAiAskCalls(sourceText, filePath).sourceText,
    filePath
  )
    .replaceAll(/^\s*(authorizeUrl|tokenUrl):\s*["'][^"']*\.raycast\.com[^"']*["'],?\n/gm, "")
    .replaceAll(/\bForm\.Values\b/g, "Form.Values<any>")
    .replaceAll(/\bgetPreferenceValues\(\)/g, "getPreferenceValues<Preferences>()")
    .replaceAll(/\bopenCommandPreferences\b/g, "openNativeCommandSettings")
    .replaceAll(/\bopenExtensionPreferences\b/g, "openNativeExtensionSettings")
    .replaceAll(/return \{ name, link:/g, 'return { name: name ?? "Quicklink", link:')
    .replaceAll(/raycast:\/\//g, "jingle://")
    .replaceAll(/(["'])raycast\1/g, "$1jingle$1")
    .replaceAll(/Raycast/g, "Jingle")

  return rewriteExtensionQuicklinkUrls(rewrittenSource, target)
}

export function detectRaycastAiAskBlockingAdapters(sourceText, filePath) {
  return rewriteRaycastAiAskCalls(sourceText, filePath).blockingAdapters
}

function rewriteRaycastAiAskCalls(sourceText, filePath) {
  let rewrittenSource = sourceText
  let hasUnsafeInput = false
  for (;;) {
    const analysis = analyzeRaycastAiAskCalls(rewrittenSource, filePath)
    hasUnsafeInput ||= analysis.hasUnsafeInput
    if (!analysis.replacement) {
      return {
        blockingAdapters: hasUnsafeInput ? [RAYCAST_AI_ASK_INPUT_BLOCKER] : [],
        sourceText: rewrittenSource
      }
    }
    rewrittenSource = `${rewrittenSource.slice(0, analysis.replacement.start)}${analysis.replacement.text}${rewrittenSource.slice(analysis.replacement.end)}`
  }
}

function analyzeRaycastAiAskCalls(sourceText, filePath) {
  const { checker, sourceFile } = createSourceAnalysisContext(sourceText, filePath)
  const bindings = readRaycastAiBindings(sourceFile, checker)
  let hasUnsafeInput = false
  let replacement = null

  const visit = (node) => {
    if (!ts.isCallExpression(node) || !isRaycastAiAskCall(node.expression, bindings, checker)) {
      ts.forEachChild(node, visit)
      return
    }

    const [input] = node.arguments
    if (!input || node.arguments.length !== 1) {
      hasUnsafeInput = true
      ts.forEachChild(node, visit)
      return
    }
    const unwrappedInput = unwrapExpression(input)
    if (!ts.isObjectLiteralExpression(unwrappedInput)) {
      hasUnsafeInput ||= !isStringExpression(input, checker)
      ts.forEachChild(node, visit)
      return
    }

    const prompt = readExactPromptInitializer(unwrappedInput)
    if (!prompt || !isStringExpression(prompt, checker)) {
      hasUnsafeInput = true
      ts.forEachChild(node, visit)
      return
    }
    replacement ??= {
      end: input.end,
      start: input.getStart(sourceFile),
      text: sourceText.slice(prompt.getStart(sourceFile), prompt.end)
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)

  return { hasUnsafeInput, replacement }
}

function createSourceAnalysisContext(sourceText, filePath) {
  const virtualFilePath = `/jingle-raycast-migration/${filePath.replace(/^\/+/, "")}`
  const compilerOptions = {
    allowJs: true,
    jsx: ts.JsxEmit.Preserve,
    noLib: true,
    noResolve: true,
    target: ts.ScriptTarget.Latest
  }
  const sourceFile = ts.createSourceFile(
    virtualFilePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  )
  const host = ts.createCompilerHost(compilerOptions, true)
  host.fileExists = (candidate) => candidate === virtualFilePath
  host.getCurrentDirectory = () => "/"
  host.getSourceFile = (candidate) => (candidate === virtualFilePath ? sourceFile : undefined)
  host.readFile = (candidate) => (candidate === virtualFilePath ? sourceText : undefined)
  const program = ts.createProgram([virtualFilePath], compilerOptions, host)
  return {
    checker: program.getTypeChecker(),
    sourceFile: program.getSourceFile(virtualFilePath)
  }
}

function readRaycastAiBindings(sourceFile, checker) {
  const named = new Set()
  const namespaces = new Set()
  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== "@raycast/api"
    ) {
      continue
    }
    const bindings = statement.importClause?.namedBindings
    if (ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) {
        if ((element.propertyName?.text ?? element.name.text) === "AI") {
          named.add(checker.getSymbolAtLocation(element.name))
        }
      }
    } else if (ts.isNamespaceImport(bindings)) {
      namespaces.add(checker.getSymbolAtLocation(bindings.name))
    }
  }
  named.delete(undefined)
  namespaces.delete(undefined)
  return { named, namespaces }
}

function isRaycastAiAskCall(expression, bindings, checker) {
  const receiver = readStaticMemberReceiver(expression, "ask")
  if (!receiver) {
    return false
  }
  if (ts.isIdentifier(receiver)) {
    return bindings.named.has(checker.getSymbolAtLocation(receiver))
  }
  const namespace = readStaticMemberReceiver(receiver, "AI")
  return Boolean(
    namespace &&
      ts.isIdentifier(namespace) &&
      bindings.namespaces.has(checker.getSymbolAtLocation(namespace))
  )
}

function readStaticMemberReceiver(expression, memberName) {
  const unwrappedExpression = unwrapExpression(expression)
  if (
    ts.isPropertyAccessExpression(unwrappedExpression) &&
    unwrappedExpression.name.text === memberName
  ) {
    return unwrapExpression(unwrappedExpression.expression)
  }
  if (
    ts.isElementAccessExpression(unwrappedExpression) &&
    isStaticMemberName(unwrappedExpression.argumentExpression, memberName)
  ) {
    return unwrapExpression(unwrappedExpression.expression)
  }
  return null
}

function isStaticMemberName(expression, memberName) {
  const unwrappedExpression = unwrapExpression(expression)
  return (
    (ts.isStringLiteral(unwrappedExpression) ||
      ts.isNoSubstitutionTemplateLiteral(unwrappedExpression)) &&
    unwrappedExpression.text === memberName
  )
}

function unwrapExpression(expression) {
  let current = expression
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isPartiallyEmittedExpression(current)
  ) {
    current = current.expression
  }
  return current
}

function isStringExpression(expression, checker) {
  return isStringType(checker.getTypeAtLocation(unwrapExpression(expression)), checker, new Set())
}

function isStringType(type, checker, seen) {
  if (seen.has(type)) {
    return false
  }
  seen.add(type)
  if ((type.flags & ts.TypeFlags.StringLike) !== 0) {
    return true
  }
  if (type.isUnion()) {
    return type.types.every((member) => isStringType(member, checker, seen))
  }
  const constraint = checker.getBaseConstraintOfType(type)
  return Boolean(constraint && constraint !== type && isStringType(constraint, checker, seen))
}

function readExactPromptInitializer(input) {
  if (input.properties.length !== 1) {
    return null
  }
  const [property] = input.properties
  if (ts.isShorthandPropertyAssignment(property) && property.name.text === "prompt") {
    return property.name
  }
  if (!ts.isPropertyAssignment(property) || !isPromptPropertyName(property.name)) {
    return null
  }
  return property.initializer
}

function isPromptPropertyName(name) {
  return (
    (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) &&
    name.text === "prompt"
  )
}

const RAYCAST_AI_ASK_INPUT_BLOCKER =
  'Uses a Raycast AI.ask input that cannot be mapped safely; use a string prompt or migrate explicitly to Jingle AI.ask({ prompt, modelPreference: "fast" }).'

export function runKnownExtensionTransforms(sourceText, filePath, target, transforms, context = {}) {
  return transforms.reduce(
    (current, transform) => {
      const transformContext = {
        ...context,
        filePath,
        sourceText: current.sourceText,
        target
      }
      const result = transform.run({
        ...transformContext
      })
      return {
        diagnostics: [...current.diagnostics, ...(result.diagnostics ?? [])],
        sourceText: result.sourceText
      }
    },
    {
      diagnostics: [],
      sourceText
    }
  )
}

function rewriteExtensionQuicklinkUrls(sourceText, target) {
  return sourceText.replace(/jingle:\/\/extensions\/([^"'`\s)]+)/g, (match, rawPathAndSearch) => {
    const [rawPath, rawSearch] = String(rawPathAndSearch).split("?", 2)
    const pathSegments = rawPath.split("/").filter(Boolean)
    const commandName =
      pathSegments.length >= 2 && pathSegments[pathSegments.length - 2] === target.sourceExtensionId
        ? pathSegments[pathSegments.length - 1]
        : null

    if (!commandName) {
      return match
    }

    return `jingle://extensions/${target.extensionId}/${commandName}${
      rawSearch ? `?${rawSearch}` : ""
    }`
  })
}

function ensureReactRuntimeImport(sourceText, filePath) {
  if (!filePath.endsWith(".tsx") || !containsJsxSyntax(sourceText)) {
    return sourceText
  }

  if (hasReactRuntimeImport(sourceText)) {
    return ensureReactRuntimeMarker(sourceText)
  }

  return `import React from "react"\nvoid React\n${sourceText}`
}

function containsJsxSyntax(sourceText) {
  return /<[A-Z][A-Za-z0-9.]*[\s>/]/.test(sourceText)
}

function hasReactRuntimeImport(sourceText) {
  return /import\s+(?:React\b|\*\s+as\s+React\b|\{\s*[^}]*\bReact\b[^}]*\})[^;\n]*\s+from\s+["']react["']/.test(
    sourceText
  )
}

function ensureReactRuntimeMarker(sourceText) {
  if (usesReactIdentifierOutsideImports(sourceText)) {
    return sourceText
  }

  return sourceText.replace(
    /(import\s+(?:React\b|\*\s+as\s+React\b|\{\s*[^}]*\bReact\b[^}]*\})[^;\n]*\s+from\s+["']react["'];?\n)/,
    "$1void React\n"
  )
}

function usesReactIdentifierOutsideImports(sourceText) {
  const body = sourceText.replaceAll(/^import\s+[\s\S]*?\s+from\s+["'][^"']+["'];?\n/gm, "")
  return /\bReact\b/.test(body)
}
