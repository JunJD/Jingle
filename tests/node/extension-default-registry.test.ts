import assert from "node:assert/strict"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { createDefaultExtensionRegistryService } from "../../src/main/extensions/registry/default-registry"

test("default extension registry keeps built-in owner when same-id installed package is broken", async () => {
  const previousJingleHome = process.env.JINGLE_HOME
  const previousRendererUrl = process.env.ELECTRON_RENDERER_URL
  const jingleHome = await mkdtemp(join(tmpdir(), "jingle-default-registry-"))

  try {
    process.env.JINGLE_HOME = jingleHome
    delete process.env.ELECTRON_RENDERER_URL
    await mkdir(join(jingleHome, "extensions", "todo-list", "1.0.0"), {
      recursive: true
    })

    const registry = createDefaultExtensionRegistryService()
    const todoListPackages = registry
      .listPackages()
      .filter((extensionPackage) => extensionPackage.id === "todo-list")

    assert.equal(todoListPackages.length, 1)
    assert.equal(todoListPackages[0]?.source, "built-in")
    assert.equal(registry.getLoadedPackage("todo-list")?.source, "built-in")
  } finally {
    if (previousJingleHome === undefined) {
      delete process.env.JINGLE_HOME
    } else {
      process.env.JINGLE_HOME = previousJingleHome
    }
    if (previousRendererUrl === undefined) {
      delete process.env.ELECTRON_RENDERER_URL
    } else {
      process.env.ELECTRON_RENDERER_URL = previousRendererUrl
    }
    await rm(jingleHome, { force: true, recursive: true })
  }
})
