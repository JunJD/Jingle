import assert from "node:assert/strict"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { setImmediate as waitForImmediate } from "node:timers/promises"
import test from "node:test"
import type { NativeExtensionMainDefinition } from "../../src/shared/native-extensions"
import { ExtensionMainDefinitionRegistry } from "../../src/main/extensions/registry/main-definition-registry"
import { loadExtensionMainDefinition } from "../../src/main/extensions/registry/main-loader"
import type { ExtensionMainRef } from "../../src/main/extensions/registry/types"

function createTrustedModuleRef(
  extensionName: string,
  modulePath = `/trusted/${extensionName}/main.mjs`
): ExtensionMainRef {
  return {
    extensionName,
    kind: "module",
    modulePath,
    trust: "trusted",
    version: "1.0.0"
  }
}

test("trusted extension main registry isolates a never-resolving module from other modules and later runs", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "jingle-extension-main-registry-"))
  const modulePaths = {
    broken: join(fixtureRoot, "broken.mjs"),
    never: join(fixtureRoot, "never.mjs"),
    ready: join(fixtureRoot, "ready.mjs")
  }
  await Promise.all([
    writeFile(modulePaths.broken, 'throw new Error("broken module")\n', "utf8"),
    writeFile(
      modulePaths.never,
      "await new Promise(() => {})\nexport default { tools: [] }\n",
      "utf8"
    ),
    writeFile(modulePaths.ready, "export default { tools: [] }\n", "utf8")
  ])
  const loadCalls: string[] = []
  const failures: string[] = []
  let reportBrokenSettled!: () => void
  let reportReadySettled!: () => void
  const brokenSettled = new Promise<void>((resolve) => {
    reportBrokenSettled = resolve
  })
  const readySettled = new Promise<void>((resolve) => {
    reportReadySettled = resolve
  })
  const registry = new ExtensionMainDefinitionRegistry({
    entries: ["never", "ready", "broken"].map((extensionName) => ({
      extensionName,
      mainRef: createTrustedModuleRef(
        extensionName,
        modulePaths[extensionName as keyof typeof modulePaths]
      )
    })),
    loadDefinition: async (mainRef) => {
      loadCalls.push(mainRef.extensionName)
      try {
        const definition = await loadExtensionMainDefinition(mainRef)
        if (mainRef.extensionName === "ready") {
          reportReadySettled()
        }
        return definition
      } catch (error) {
        if (mainRef.extensionName === "broken") {
          reportBrokenSettled()
        }
        throw error
      }
    },
    onError: ({ extensionName, phase }) => {
      failures.push(`${phase}:${extensionName}`)
    },
    shutdownTimeoutMs: 20
  })

  try {
    registry.start()
    await Promise.all([brokenSettled, readySettled])
    await waitForImmediate()

    const firstRunSnapshot = registry.readSnapshot()
    assert.deepEqual(
      firstRunSnapshot.definitions.map(([extensionName]) => extensionName),
      ["ready"]
    )
    assert.deepEqual(firstRunSnapshot.pendingExtensionNames, ["never"])
    assert.deepEqual(firstRunSnapshot.failures, [
      { extensionName: "broken", message: "broken module" }
    ])
    assert.deepEqual(failures, ["load:broken"])
    assert.equal(Object.isFrozen(firstRunSnapshot), true)
    assert.equal(Object.isFrozen(firstRunSnapshot.definitions), true)
    assert.equal(Object.isFrozen(firstRunSnapshot.definitions[0]), true)
    assert.equal(Object.isFrozen(firstRunSnapshot.definitions[0]?.[1]), true)

    const firstRunDefinitions = new Map(firstRunSnapshot.definitions)
    const laterRunDefinitions = new Map(registry.readSnapshot().definitions)
    assert.ok(firstRunDefinitions.has("ready"))
    assert.ok(laterRunDefinitions.has("ready"))
    assert.equal(firstRunDefinitions.has("never"), false)
    assert.equal(laterRunDefinitions.has("never"), false)

    registry.start()
    assert.deepEqual(loadCalls.sort(), ["broken", "never", "ready"])

    await registry.dispose()
    assert.deepEqual(failures, ["load:broken", "shutdown:never"])
  } finally {
    await registry.dispose()
    await rm(fixtureRoot, { force: true, recursive: true })
  }
})

test("trusted extension main registry owns loaded and late definition disposal", async () => {
  let resolveLateDefinition!: (definition: NativeExtensionMainDefinition) => void
  let releaseLateDisposal!: () => void
  let reportLateDisposalStarted!: () => void
  const disposed: string[] = []
  const shutdownFailures: string[] = []
  const lateDefinition = new Promise<NativeExtensionMainDefinition>((resolve) => {
    resolveLateDefinition = resolve
  })
  const lateDisposalGate = new Promise<void>((resolve) => {
    releaseLateDisposal = resolve
  })
  const lateDisposalStarted = new Promise<void>((resolve) => {
    reportLateDisposalStarted = resolve
  })
  const registry = new ExtensionMainDefinitionRegistry({
    entries: ["loaded", "late"].map((extensionName) => ({
      extensionName,
      mainRef: createTrustedModuleRef(extensionName)
    })),
    loadDefinition: async (mainRef) => {
      if (mainRef.extensionName === "late") {
        return lateDefinition
      }
      return {
        dispose: () => {
          disposed.push("loaded")
        }
      }
    },
    onError: ({ extensionName, phase }) => {
      shutdownFailures.push(`${phase}:${extensionName}`)
    },
    shutdownTimeoutMs: 20
  })

  registry.start()
  for (let attempt = 0; attempt < 20 && !registry.getDefinition("loaded"); attempt += 1) {
    await Promise.resolve()
  }
  assert.ok(registry.getDefinition("loaded"))
  await registry.dispose()
  assert.deepEqual(disposed, ["loaded"])
  assert.deepEqual(shutdownFailures, ["shutdown:late"])
  assert.deepEqual(registry.readSnapshot().definitions, [])

  resolveLateDefinition({
    dispose: async () => {
      reportLateDisposalStarted()
      await lateDisposalGate
      disposed.push("late")
    }
  })
  await lateDisposalStarted
  let secondDisposeSettled = false
  const secondDispose = registry.dispose().then(() => {
    secondDisposeSettled = true
  })
  await Promise.resolve()
  assert.equal(secondDisposeSettled, false)
  releaseLateDisposal()
  await secondDispose
  assert.deepEqual(disposed, ["loaded", "late"])

  await registry.dispose()
  assert.deepEqual(disposed, ["loaded", "late"])
})

test("trusted extension main registry disposes a loaded definition rejected by validation exactly once", async () => {
  const disposed: string[] = []
  const definition: NativeExtensionMainDefinition = {
    dispose: () => {
      disposed.push("invalid")
    }
  }
  const registry = new ExtensionMainDefinitionRegistry({
    entries: [
      {
        extensionName: "invalid",
        mainRef: {
          definition,
          extensionName: "invalid",
          kind: "in-memory",
          trust: "trusted",
          version: "1.0.0"
        }
      }
    ],
    loadDefinition: async () => definition,
    validateDefinition: () => {
      throw new Error("invalid definition")
    }
  })

  registry.start()
  assert.deepEqual(registry.readSnapshot().failures, [
    { extensionName: "invalid", message: "invalid definition" }
  ])
  await registry.dispose()
  await registry.dispose()
  assert.deepEqual(disposed, ["invalid"])
})
