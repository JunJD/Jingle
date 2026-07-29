export const extensionRuntimeHostModuleSpecifiers = Object.freeze([
  "node:http",
  "node:https",
  "node:path",
  "node:punycode",
  "node:stream",
  "node:url",
  "node:zlib"
])

export const extensionRuntimeUnavailableOptionalDependencies = Object.freeze(["canvas", "encoding"])

export function normalizeExtensionRuntimeHostModuleSpecifier(specifier) {
  const canonicalSpecifier = specifier.startsWith("node:") ? specifier : `node:${specifier}`
  return extensionRuntimeHostModuleSpecifiers.includes(canonicalSpecifier)
    ? canonicalSpecifier
    : null
}
