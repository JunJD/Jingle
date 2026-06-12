export type InstalledExtensionTrustLevel = "trusted" | "untrusted"

export interface InstalledExtensionDescriptorFile {
  assets: string
  id: string
  main?: string | null
  manifest: string
  runtime?: string | null
  runtimeMetadata?: string | null
  schemaVersion: 1
  trust: InstalledExtensionTrustLevel
  version: string
}

export function parseInstalledExtensionDescriptorFile(
  value: unknown
): InstalledExtensionDescriptorFile {
  if (!isRecord(value)) {
    throw new Error("Installed extension descriptor must be an object")
  }

  if (value.schemaVersion !== 1) {
    throw new Error("Installed extension descriptor schemaVersion must be 1")
  }

  return {
    assets: readRequiredString(value, "assets"),
    id: readRequiredString(value, "id"),
    main: readOptionalString(value, "main"),
    manifest: readRequiredString(value, "manifest"),
    runtime: readOptionalString(value, "runtime"),
    runtimeMetadata: readOptionalString(value, "runtimeMetadata"),
    schemaVersion: 1,
    trust: readOptionalTrustLevel(value, "trust") ?? "untrusted",
    version: readRequiredString(value, "version")
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function readRequiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key]
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Installed extension descriptor ${key} must be a non-empty string`)
  }
  return value
}

function readOptionalString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key]
  if (value === null || value === undefined) {
    return null
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(
      `Installed extension descriptor ${key} must be a non-empty string when declared`
    )
  }
  return value
}

function readOptionalTrustLevel(
  record: Record<string, unknown>,
  key: string
): InstalledExtensionTrustLevel | null {
  const value = record[key]
  if (value === null || value === undefined) {
    return null
  }
  if (value === "trusted" || value === "untrusted") {
    return value
  }
  throw new Error(`Installed extension descriptor ${key} must be "trusted" or "untrusted"`)
}
