export declare const extensionRuntimeHostModuleSpecifiers: readonly [
  "node:http",
  "node:https",
  "node:path",
  "node:punycode",
  "node:stream",
  "node:url",
  "node:zlib"
]

export declare const extensionRuntimeUnavailableOptionalDependencies: readonly [
  "canvas",
  "encoding"
]

export declare function normalizeExtensionRuntimeHostModuleSpecifier(
  specifier: string
): (typeof extensionRuntimeHostModuleSpecifiers)[number] | null
