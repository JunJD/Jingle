import { createHash } from "node:crypto"
import { open, realpath } from "node:fs/promises"
import { pathToFileURL } from "node:url"
import { SourceTextModule, SyntheticModule, type Module as VmModule } from "node:vm"
import { nativeExtensionRuntimePackages } from "@extensions/runtime-packages"
import type { ExtensionRuntimeLaunchPackageRef } from "@shared/extension-runtime-protocol"
import type {
  NativeExtensionRuntimeCommandDefinition,
  NativeExtensionRuntimePackage
} from "@jingle/extension-api"

type RuntimeArtifactRevision = `sha256:${string}`

export type ExtensionRuntimeArtifactLoadErrorCode =
  | "runtime_artifact_dependency_unsupported"
  | "runtime_artifact_evaluation_failed"
  | "runtime_artifact_evaluator_unavailable"
  | "runtime_artifact_read_failed"
  | "runtime_artifact_revision_invalid"
  | "runtime_artifact_revision_mismatch"
  | "runtime_artifact_revision_missing"

const RUNTIME_ARTIFACT_REVISION_PATTERN = /^sha256:[a-f0-9]{64}$/

const builtInRuntimePackagesByExtensionName = new Map(
  nativeExtensionRuntimePackages.map((runtimePackage) => [
    runtimePackage.extensionName,
    runtimePackage
  ])
)

const loadedRuntimeModules = new Map<string, Promise<NativeExtensionRuntimePackage>>()

export class ExtensionRuntimeArtifactLoadError extends Error {
  readonly diagnosticReference: string

  constructor(
    readonly code: ExtensionRuntimeArtifactLoadErrorCode,
    extensionName: string,
    expectedRevision: unknown
  ) {
    const diagnosticReference = createArtifactDiagnosticReference(extensionName, expectedRevision)
    super(`${getArtifactErrorMessage(code)} [artifact=${diagnosticReference}]`)
    this.name = "ExtensionRuntimeArtifactLoadError"
    this.diagnosticReference = diagnosticReference
  }
}

export async function loadNativeExtensionRuntimeCommand(
  runtimeRef: ExtensionRuntimeLaunchPackageRef,
  params: {
    commandName: string
    extensionName: string
  }
): Promise<NativeExtensionRuntimeCommandDefinition> {
  if (runtimeRef.extensionName !== params.extensionName) {
    throw new Error(
      `Extension runtime ref "${runtimeRef.extensionName}" cannot launch "${params.extensionName}:${params.commandName}".`
    )
  }

  const runtimePackage = await loadNativeExtensionRuntimePackage(runtimeRef)
  const command = runtimePackage.commands[params.commandName]
  if (!command) {
    throw new Error(
      `Extension runtime command "${params.extensionName}:${params.commandName}" is not registered.`
    )
  }

  return {
    ...command,
    commandName: params.commandName,
    extensionName: params.extensionName
  }
}

async function loadNativeExtensionRuntimePackage(
  runtimeRef: ExtensionRuntimeLaunchPackageRef
): Promise<NativeExtensionRuntimePackage> {
  if (runtimeRef.kind === "built-in") {
    const runtimePackage = builtInRuntimePackagesByExtensionName.get(runtimeRef.extensionName)
    if (!runtimePackage) {
      throw new Error(`Built-in extension runtime "${runtimeRef.extensionName}" is not registered.`)
    }

    return runtimePackage
  }

  const expectedRevision = assertExpectedRuntimeArtifactRevision(runtimeRef)
  const moduleKey = [runtimeRef.extensionName, expectedRevision, runtimeRef.modulePath].join("\0")
  let modulePromise = loadedRuntimeModules.get(moduleKey)
  if (!modulePromise) {
    modulePromise = loadVerifiedRuntimeModule(runtimeRef, expectedRevision)
    loadedRuntimeModules.set(moduleKey, modulePromise)
  }

  return modulePromise
}

async function loadVerifiedRuntimeModule(
  runtimeRef: Extract<ExtensionRuntimeLaunchPackageRef, { kind: "module" }>,
  expectedRevision: RuntimeArtifactRevision
): Promise<NativeExtensionRuntimePackage> {
  const verifiedArtifact = await readVerifiedRuntimeArtifact(runtimeRef, expectedRevision)
  const module = await evaluateVerifiedRuntimeArtifact(
    runtimeRef.extensionName,
    expectedRevision,
    verifiedArtifact
  )
  return readRuntimePackageModule(runtimeRef.extensionName, module.namespace)
}

async function readVerifiedRuntimeArtifact(
  runtimeRef: Extract<ExtensionRuntimeLaunchPackageRef, { kind: "module" }>,
  expectedRevision: RuntimeArtifactRevision
): Promise<{ canonicalModuleUrl: string; source: string }> {
  let handle: Awaited<ReturnType<typeof open>> | null = null
  try {
    const canonicalPathBeforeRead = await realpath(runtimeRef.modulePath)
    handle = await open(canonicalPathBeforeRead, "r")
    const stat = await handle.stat()
    if (!stat.isFile()) {
      throw new ExtensionRuntimeArtifactLoadError(
        "runtime_artifact_read_failed",
        runtimeRef.extensionName,
        expectedRevision
      )
    }
    const bytes = await handle.readFile()
    const canonicalPathAfterRead = await realpath(runtimeRef.modulePath)
    if (canonicalPathAfterRead !== canonicalPathBeforeRead) {
      throw new ExtensionRuntimeArtifactLoadError(
        "runtime_artifact_read_failed",
        runtimeRef.extensionName,
        expectedRevision
      )
    }

    const actualRevision = `sha256:${createHash("sha256").update(bytes).digest("hex")}`
    if (actualRevision !== expectedRevision) {
      throw new ExtensionRuntimeArtifactLoadError(
        "runtime_artifact_revision_mismatch",
        runtimeRef.extensionName,
        expectedRevision
      )
    }

    return {
      canonicalModuleUrl: pathToFileURL(canonicalPathBeforeRead).href,
      source: bytes.toString("utf8")
    }
  } catch (error) {
    if (error instanceof ExtensionRuntimeArtifactLoadError) {
      throw error
    }
    throw new ExtensionRuntimeArtifactLoadError(
      "runtime_artifact_read_failed",
      runtimeRef.extensionName,
      expectedRevision
    )
  } finally {
    await handle?.close().catch(() => undefined)
  }
}

async function evaluateVerifiedRuntimeArtifact(
  extensionName: string,
  expectedRevision: RuntimeArtifactRevision,
  artifact: { canonicalModuleUrl: string; source: string }
): Promise<SourceTextModule> {
  if (typeof SourceTextModule !== "function" || typeof SyntheticModule !== "function") {
    throw new ExtensionRuntimeArtifactLoadError(
      "runtime_artifact_evaluator_unavailable",
      extensionName,
      expectedRevision
    )
  }

  try {
    const module = new SourceTextModule(artifact.source, {
      identifier: artifact.canonicalModuleUrl,
      initializeImportMeta: (meta) => {
        meta.url = artifact.canonicalModuleUrl
      }
    })
    await module.link((specifier) =>
      linkRuntimeArtifactDependency(specifier, extensionName, expectedRevision)
    )
    await module.evaluate()
    return module
  } catch (error) {
    if (error instanceof ExtensionRuntimeArtifactLoadError) {
      throw error
    }
    throw new ExtensionRuntimeArtifactLoadError(
      "runtime_artifact_evaluation_failed",
      extensionName,
      expectedRevision
    )
  }
}

async function linkRuntimeArtifactDependency(
  specifier: string,
  extensionName: string,
  expectedRevision: RuntimeArtifactRevision
): Promise<VmModule> {
  if (!specifier.startsWith("node:")) {
    throw new ExtensionRuntimeArtifactLoadError(
      "runtime_artifact_dependency_unsupported",
      extensionName,
      expectedRevision
    )
  }

  const namespace = await import(specifier)
  const exportNames = Object.keys(namespace)
  return new SyntheticModule(exportNames, function () {
    for (const exportName of exportNames) {
      this.setExport(exportName, namespace[exportName])
    }
  })
}

function assertExpectedRuntimeArtifactRevision(
  runtimeRef: Extract<ExtensionRuntimeLaunchPackageRef, { kind: "module" }>
): RuntimeArtifactRevision {
  const revision = (runtimeRef as { expectedRuntimeArtifactRevision?: unknown })
    .expectedRuntimeArtifactRevision
  if (revision === undefined || revision === null || revision === "") {
    throw new ExtensionRuntimeArtifactLoadError(
      "runtime_artifact_revision_missing",
      runtimeRef.extensionName,
      revision
    )
  }
  if (typeof revision !== "string" || !RUNTIME_ARTIFACT_REVISION_PATTERN.test(revision)) {
    throw new ExtensionRuntimeArtifactLoadError(
      "runtime_artifact_revision_invalid",
      runtimeRef.extensionName,
      revision
    )
  }
  return revision as RuntimeArtifactRevision
}

function readRuntimePackageModule(
  extensionName: string,
  module: unknown
): NativeExtensionRuntimePackage {
  if (!module || typeof module !== "object") {
    throw new Error(
      `Installed extension "${extensionName}" runtime module did not export an object`
    )
  }

  const exportsRecord = module as Record<string, unknown>
  const runtimePackage = exportsRecord.default ?? exportsRecord.runtime
  if (!runtimePackage || typeof runtimePackage !== "object") {
    throw new Error(
      `Installed extension "${extensionName}" runtime module must export a NativeExtensionRuntimePackage as default`
    )
  }

  const candidate = runtimePackage as NativeExtensionRuntimePackage
  if (candidate.extensionName !== extensionName) {
    throw new Error(
      "Installed extension runtime package identity does not match its launch reference."
    )
  }

  return candidate
}

function createArtifactDiagnosticReference(extensionName: string, revision: unknown): string {
  const revisionFact =
    typeof revision === "string" && RUNTIME_ARTIFACT_REVISION_PATTERN.test(revision)
      ? revision
      : "missing"
  const correlation = createHash("sha256")
    .update(extensionName)
    .update("\0")
    .update(revisionFact)
    .digest("hex")
    .slice(0, 12)
  return `${extensionName}:${correlation}`
}

function getArtifactErrorMessage(code: ExtensionRuntimeArtifactLoadErrorCode): string {
  switch (code) {
    case "runtime_artifact_dependency_unsupported":
      return "Installed extension runtime artifact declares an unsupported module dependency."
    case "runtime_artifact_evaluation_failed":
      return "Installed extension runtime artifact evaluation failed."
    case "runtime_artifact_evaluator_unavailable":
      return "Installed extension runtime artifact evaluator is unavailable."
    case "runtime_artifact_read_failed":
      return "Installed extension runtime artifact could not be read safely."
    case "runtime_artifact_revision_invalid":
      return "Extension runtime launch contains an invalid artifact revision."
    case "runtime_artifact_revision_mismatch":
      return "Installed extension runtime artifact no longer matches its verified revision."
    case "runtime_artifact_revision_missing":
      return "Extension runtime launch is missing its verified artifact revision."
  }
}
