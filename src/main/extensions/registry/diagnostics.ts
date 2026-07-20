import type {
  NativeExtensionInstallDiagnostic,
  NativeExtensionInstallDiagnosticCode
} from "@shared/native-extensions"
import type { FailedExtensionPackageDescriptor } from "./types"

const MAX_IDENTITY_LENGTH = 128

const diagnosticMessages = {
  asset_path_invalid: "The extension assets directory is missing or outside the package.",
  descriptor_invalid: "The jingle.extension.json descriptor is invalid.",
  descriptor_missing: "The jingle.extension.json descriptor is missing.",
  main_invalid: "The privileged main entry is invalid or outside the package.",
  main_missing: "The privileged main entry declared by the package is missing.",
  manifest_invalid: "The extension manifest is invalid or does not match the descriptor.",
  manifest_missing: "The extension manifest declared by the package is missing.",
  runtime_artifact_revision_invalid:
    "The runtime artifact does not match its content-addressed revision.",
  runtime_invalid: "The runtime entry is invalid or outside the package.",
  runtime_metadata_invalid: "The runtime metadata is invalid or does not match the descriptor.",
  runtime_metadata_missing: "The runtime metadata declared by the package is missing.",
  runtime_missing: "The runtime entry declared by the package is missing."
} satisfies Record<NativeExtensionInstallDiagnosticCode, string>

export function toNativeExtensionInstallDiagnostics(
  packages: readonly FailedExtensionPackageDescriptor[]
): NativeExtensionInstallDiagnostic[] {
  return packages
    .map((extensionPackage) => ({
      errors: [...new Set(extensionPackage.errors.map((error) => error.code))]
        .sort(compareCodeUnitStrings)
        .map((code) => ({ code, message: diagnosticMessages[code] })),
      extensionName: normalizeDiagnosticIdentity(extensionPackage.id, "unknown-extension"),
      status: "error" as const,
      version:
        extensionPackage.version === null
          ? null
          : normalizeDiagnosticIdentity(extensionPackage.version, "unknown-version")
    }))
    .sort(compareDiagnostics)
}

function normalizeDiagnosticIdentity(value: string, fallback: string): string {
  const normalized = [...value]
    .map((character) => {
      const codePoint = character.codePointAt(0) ?? 0
      return codePoint <= 0x1f || codePoint === 0x7f ? " " : character
    })
    .join("")
    .trim()
  return [...(normalized || fallback)].slice(0, MAX_IDENTITY_LENGTH).join("")
}

function compareDiagnostics(
  left: NativeExtensionInstallDiagnostic,
  right: NativeExtensionInstallDiagnostic
): number {
  const extensionNameOrder = compareCodeUnitStrings(left.extensionName, right.extensionName)
  if (extensionNameOrder !== 0) return extensionNameOrder

  const versionOrder = compareCodeUnitStrings(left.version ?? "", right.version ?? "")
  if (versionOrder !== 0) return versionOrder

  return compareCodeUnitStrings(
    left.errors.map((error) => error.code).join("\u0000"),
    right.errors.map((error) => error.code).join("\u0000")
  )
}

function compareCodeUnitStrings(left: string, right: string): number {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}
