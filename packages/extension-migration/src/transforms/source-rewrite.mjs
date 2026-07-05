import { rewriteRaycastRuntimeImports } from "./import-rewrite.mjs"
import { getApplicableTransforms, knownExtensionTransforms } from "./known-extensions/index.mjs"

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
    sourceText: ensureReactRuntimeImport(knownExtensionResult.sourceText, filePath)
  }
}

export function rewriteGenericSourceForJingle(sourceText, filePath, target) {
  const rewrittenSource = rewriteRaycastRuntimeImports(sourceText, filePath)
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
