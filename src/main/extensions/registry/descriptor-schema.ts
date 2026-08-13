import {
  parseInstalledExtensionId,
  parseInstalledExtensionVersion
} from "@jingle/extension-cli/installed-package-path"

export type InstalledExtensionTrustLevel = "trusted" | "untrusted"
export type InstalledExtensionRuntimeArtifactRevision = `sha256:${string}`
export type InstalledExtensionMainArtifactRevision = `sha256:${string}`

const RUNTIME_ARTIFACT_REVISION_PATTERN = /^sha256:[a-f0-9]{64}$/

export interface InstalledExtensionDescriptorFile {
  assets: string
  id: string
  main?: string | null
  mainArtifactRevision: InstalledExtensionMainArtifactRevision | null
  manifest: string
  runtime?: string | null
  runtimeArtifactRevision: InstalledExtensionRuntimeArtifactRevision | null
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

  const runtime = readOptionalString(value, "runtime")
  const runtimeArtifactRevision = readOptionalRuntimeArtifactRevision(value)
  if (!runtime && runtimeArtifactRevision) {
    throw new Error(
      "Installed extension descriptor runtimeArtifactRevision requires a runtime module"
    )
  }
  const main = readOptionalString(value, "main")
  const mainArtifactRevision = readOptionalArtifactRevision(value, "mainArtifactRevision")
  if (!main && mainArtifactRevision) {
    throw new Error("Installed extension descriptor mainArtifactRevision requires a main module")
  }

  return {
    assets: readRequiredString(value, "assets"),
    id: parseInstalledExtensionId(readRequiredString(value, "id")),
    main,
    mainArtifactRevision,
    manifest: readRequiredString(value, "manifest"),
    runtime,
    runtimeArtifactRevision,
    runtimeMetadata: readOptionalString(value, "runtimeMetadata"),
    schemaVersion: 1,
    trust: readOptionalTrustLevel(value, "trust") ?? "untrusted",
    version: parseInstalledExtensionVersion(readRequiredString(value, "version"))
  }
}

function readOptionalRuntimeArtifactRevision(
  record: Record<string, unknown>
): InstalledExtensionRuntimeArtifactRevision | null {
  const value = record.runtimeArtifactRevision
  if (value === null || value === undefined) {
    return null
  }
  if (typeof value !== "string" || !RUNTIME_ARTIFACT_REVISION_PATTERN.test(value)) {
    throw new Error(
      "Installed extension descriptor runtimeArtifactRevision must be a sha256 content revision"
    )
  }
  return value as InstalledExtensionRuntimeArtifactRevision
}

function readOptionalArtifactRevision(
  record: Record<string, unknown>,
  key: string
): InstalledExtensionMainArtifactRevision | null {
  const value = record[key]
  if (value === null || value === undefined) {
    return null
  }
  if (typeof value !== "string" || !RUNTIME_ARTIFACT_REVISION_PATTERN.test(value)) {
    throw new Error(`Installed extension descriptor ${key} must be a sha256 content revision`)
  }
  return value as InstalledExtensionMainArtifactRevision
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
