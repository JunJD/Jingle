import assert from "node:assert/strict"
import test from "node:test"
import { toNativeExtensionInstallDiagnostics } from "../../src/main/extensions/registry/diagnostics"
import type { FailedExtensionPackageDescriptor } from "../../src/main/extensions/registry/types"

test("install diagnostics are deterministic, bounded, and omit raw package failures", () => {
  const rawSecret = "secret-token-from-descriptor"
  const rawPath = "/Users/example/.jingle/extensions/private-extension"
  const packages: FailedExtensionPackageDescriptor[] = [
    failedPackage({
      codes: ["runtime_missing", "descriptor_invalid", "runtime_missing"],
      id: `  private\u0000extension-${"x".repeat(180)}  `,
      messages: [rawPath, rawSecret, `${rawPath}/dist/runtime.mjs`],
      version: `  1.0.0\u0007-${"y".repeat(180)}  `
    }),
    failedPackage({
      codes: ["manifest_missing"],
      id: "alpha",
      messages: [rawSecret],
      version: null
    })
  ]

  const diagnostics = toNativeExtensionInstallDiagnostics(packages)

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.extensionName),
    ["alpha", `private extension-${"x".repeat(110)}`]
  )
  assert.equal(diagnostics[1]?.extensionName.length, 128)
  assert.equal(diagnostics[1]?.version?.length, 128)
  assert.deepEqual(
    diagnostics[1]?.errors.map((error) => error.code),
    ["descriptor_invalid", "runtime_missing"]
  )
  const serialized = JSON.stringify(diagnostics)
  assert.doesNotMatch(serialized, /Users\/example/)
  assert.doesNotMatch(serialized, /secret-token/)
  assert.match(serialized, /jingle\.extension\.json descriptor is invalid/)
})

function failedPackage(input: {
  codes: FailedExtensionPackageDescriptor["errors"][number]["code"][]
  id: string
  messages: string[]
  version: string | null
}): FailedExtensionPackageDescriptor {
  return {
    assetsDir: null,
    enabled: false,
    errors: input.codes.map((code, index) => ({
      code,
      message: input.messages[index] ?? input.messages[0] ?? "raw failure"
    })),
    id: input.id,
    rootDir: "/private/raw/package/root",
    source: "installed",
    status: "error",
    trust: "untrusted",
    version: input.version
  }
}
