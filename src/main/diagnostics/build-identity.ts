const SOURCE_REVISION_PATTERN = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/

export type DiagnosticsBuildIdentity =
  | { declaredBy: "release-workflow"; kind: "build-declared"; sourceRevision: string }
  | { kind: "untrusted" }

declare const __JINGLE_DIAGNOSTICS_BUILD_IDENTITY__: unknown

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
}

function hasExactKeys(record: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(record).sort()
  const sortedExpected = [...expected].sort()
  return (
    actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
  )
}

export function parseDiagnosticsBuildIdentity(value: unknown): DiagnosticsBuildIdentity {
  if (!isPlainRecord(value) || typeof value.kind !== "string") {
    throw new Error("Invalid Jingle diagnostics build identity.")
  }

  if (value.kind === "untrusted" && hasExactKeys(value, ["kind"])) {
    return { kind: "untrusted" }
  }

  if (
    value.kind === "build-declared" &&
    value.declaredBy === "release-workflow" &&
    hasExactKeys(value, ["declaredBy", "kind", "sourceRevision"]) &&
    typeof value.sourceRevision === "string" &&
    SOURCE_REVISION_PATTERN.test(value.sourceRevision)
  ) {
    return {
      declaredBy: "release-workflow",
      kind: "build-declared",
      sourceRevision: value.sourceRevision
    }
  }

  throw new Error("Invalid Jingle diagnostics build identity.")
}

const embeddedBuildIdentity =
  typeof __JINGLE_DIAGNOSTICS_BUILD_IDENTITY__ === "undefined"
    ? { kind: "untrusted" }
    : __JINGLE_DIAGNOSTICS_BUILD_IDENTITY__

export const diagnosticsBuildIdentity = parseDiagnosticsBuildIdentity(embeddedBuildIdentity)

export function getDiagnosticsBuildSourceRevision(
  identity: DiagnosticsBuildIdentity = diagnosticsBuildIdentity
):
  | { kind: "available"; provenance: "build-declared"; value: string }
  | { kind: "unavailable"; reason: "untrusted-build" } {
  return identity.kind === "build-declared"
    ? { kind: "available", provenance: "build-declared", value: identity.sourceRevision }
    : { kind: "unavailable", reason: "untrusted-build" }
}
