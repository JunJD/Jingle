import assert from "node:assert/strict"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
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
    assert.deepEqual(
      registry.listFailedInstalledPackages().map((extensionPackage) => ({
        codes: extensionPackage.errors.map((error) => error.code),
        id: extensionPackage.id,
        version: extensionPackage.version
      })),
      [{ codes: ["descriptor_missing"], id: "todo-list", version: null }]
    )
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

test("default extension registry selects installed owners by SemVer precedence", async () => {
  const previousJingleHome = process.env.JINGLE_HOME
  const previousRendererUrl = process.env.ELECTRON_RENDERER_URL
  const jingleHome = await mkdtemp(join(tmpdir(), "jingle-default-registry-"))
  const extensionsRoot = join(jingleHome, "extensions")

  try {
    process.env.JINGLE_HOME = jingleHome
    delete process.env.ELECTRON_RENDERER_URL
    await Promise.all([
      writeInstalledExtension(extensionsRoot, "semver-major", "2.0.0"),
      writeInstalledExtension(extensionsRoot, "semver-major", "10.0.0"),
      writeInstalledExtension(extensionsRoot, "semver-stable", "1.0.0-beta.1"),
      writeInstalledExtension(extensionsRoot, "semver-stable", "1.0.0")
    ])

    const registry = createDefaultExtensionRegistryService()

    assert.equal(registry.getLoadedPackage("semver-major")?.version, "10.0.0")
    assert.equal(registry.getLoadedPackage("semver-stable")?.version, "1.0.0")
  } finally {
    restoreEnvironment("JINGLE_HOME", previousJingleHome)
    restoreEnvironment("ELECTRON_RENDERER_URL", previousRendererUrl)
    await rm(jingleHome, { force: true, recursive: true })
  }
})

async function writeInstalledExtension(
  extensionsRoot: string,
  extensionId: string,
  version: string
): Promise<void> {
  const packageRoot = join(extensionsRoot, extensionId, version)
  await mkdir(join(packageRoot, "assets"), { recursive: true })
  await Promise.all([
    writeFile(join(packageRoot, "assets", "icon.svg"), "<svg />"),
    writeFile(
      join(packageRoot, "manifest.json"),
      JSON.stringify({
        capabilities: [],
        commands: [],
        connection: {
          auth: { type: "none" },
          id: "default",
          provider: extensionId,
          title: extensionId
        },
        icon: "assets/icon.svg",
        name: extensionId,
        title: extensionId
      })
    ),
    writeFile(
      join(packageRoot, "jingle.extension.json"),
      JSON.stringify({
        assets: "./assets",
        id: extensionId,
        manifest: "./manifest.json",
        schemaVersion: 1,
        version
      })
    )
  ])
}

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name]
  } else {
    process.env[name] = value
  }
}
