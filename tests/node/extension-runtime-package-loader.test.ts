import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import {
  ExtensionRuntimeArtifactLoadError,
  loadNativeExtensionRuntimeCommand
} from "../../src/extension-runtime/runtime-package-loader"
import {
  EXTENSION_RUNTIME_VM_MODULE_EXEC_ARGV,
  type ExtensionRuntimeLaunchPackageRef
} from "../../src/shared/extension-runtime-protocol"

function createRevision(source: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(source).digest("hex")}`
}

function createRuntimeSource(extensionName: string, marker: string): string {
  return [
    `globalThis.__jingleVerifiedRuntimeMarkers ??= [];`,
    `globalThis.__jingleVerifiedRuntimeMarkers.push(${JSON.stringify(marker)});`,
    `export default {`,
    `  extensionName: ${JSON.stringify(extensionName)},`,
    `  commands: { execute: { mode: "no-view", run: async () => ${JSON.stringify(marker)} } }`,
    `};`
  ].join("\n")
}

test("node test runtime enables the production artifact evaluator requirement", () => {
  for (const argument of EXTENSION_RUNTIME_VM_MODULE_EXEC_ARGV) {
    assert.ok(process.execArgv.includes(argument))
  }
})

test("installed runtime launch rejects a missing expected artifact revision without reading its path", async () => {
  const modulePath = "/private/runtime-path-must-stay-redacted.mjs"
  const runtimeRef = {
    extensionName: "missing-revision",
    kind: "module",
    modulePath,
    version: "1.0.0"
  } as unknown as ExtensionRuntimeLaunchPackageRef

  await assert.rejects(
    loadNativeExtensionRuntimeCommand(runtimeRef, {
      commandName: "execute",
      extensionName: "missing-revision"
    }),
    (error: unknown) => {
      assert.ok(error instanceof ExtensionRuntimeArtifactLoadError)
      assert.equal(error.code, "runtime_artifact_revision_missing")
      assert.match(error.diagnosticReference, /^missing-revision:[a-f0-9]{12}$/)
      assert.doesNotMatch(error.message, /private|runtime-path/)
      return true
    }
  )
})

test("installed runtime artifact mismatch fails before top-level evaluation", async () => {
  const root = await mkdtemp(join(tmpdir(), "jingle-runtime-loader-mismatch-"))
  const modulePath = join(root, "runtime.mjs")
  const marker = `mismatch-${Date.now()}`
  const source = createRuntimeSource("mismatch-runtime", marker)
  await writeFile(modulePath, source)

  try {
    const expectedRuntimeArtifactRevision = `sha256:${"a".repeat(64)}` as const
    await assert.rejects(
      loadNativeExtensionRuntimeCommand(
        {
          expectedRuntimeArtifactRevision,
          extensionName: "mismatch-runtime",
          kind: "module",
          modulePath,
          version: "1.0.0"
        },
        { commandName: "execute", extensionName: "mismatch-runtime" }
      ),
      (error: unknown) => {
        assert.ok(error instanceof ExtensionRuntimeArtifactLoadError)
        assert.equal(error.code, "runtime_artifact_revision_mismatch")
        assert.match(error.diagnosticReference, /^mismatch-runtime:[a-f0-9]{12}$/)
        assert.doesNotMatch(error.message, new RegExp(root))
        assert.doesNotMatch(error.message, new RegExp(expectedRuntimeArtifactRevision))
        assert.doesNotMatch(error.message, /aaaaaaaaaaaa/)
        return true
      }
    )
    assert.equal(
      (
        ((globalThis as Record<string, unknown>).__jingleVerifiedRuntimeMarkers as
          | string[]
          | undefined) ?? []
      ).includes(marker),
      false
    )
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})

test("installed runtime evaluates verified bytes and keys its module cache by revision", async () => {
  const root = await mkdtemp(join(tmpdir(), "jingle-runtime-loader-verified-"))
  const modulePath = join(root, "runtime.mjs")
  const extensionName = `verified-runtime-${Date.now()}`
  const firstSource = createRuntimeSource(extensionName, "first")
  const firstRevision = createRevision(firstSource)
  await writeFile(modulePath, firstSource)

  try {
    const firstRef = {
      expectedRuntimeArtifactRevision: firstRevision,
      extensionName,
      kind: "module" as const,
      modulePath,
      version: "1.0.0"
    }
    const firstCommand = await loadNativeExtensionRuntimeCommand(firstRef, {
      commandName: "execute",
      extensionName
    })
    assert.equal(firstCommand.mode, "no-view")
    if (firstCommand.mode !== "no-view") {
      throw new Error("Expected no-view command")
    }
    assert.equal((await firstCommand.run({} as never)) as unknown, "first")

    const secondSource = createRuntimeSource(extensionName, "second")
    await writeFile(modulePath, secondSource)
    const cachedCommand = await loadNativeExtensionRuntimeCommand(firstRef, {
      commandName: "execute",
      extensionName
    })
    assert.equal(cachedCommand.mode, "no-view")
    if (cachedCommand.mode !== "no-view") {
      throw new Error("Expected cached no-view command")
    }
    assert.equal((await cachedCommand.run({} as never)) as unknown, "first")

    const secondCommand = await loadNativeExtensionRuntimeCommand(
      {
        ...firstRef,
        expectedRuntimeArtifactRevision: createRevision(secondSource)
      },
      { commandName: "execute", extensionName }
    )
    assert.equal(secondCommand.mode, "no-view")
    if (secondCommand.mode !== "no-view") {
      throw new Error("Expected revised no-view command")
    }
    assert.equal((await secondCommand.run({} as never)) as unknown, "second")
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})
