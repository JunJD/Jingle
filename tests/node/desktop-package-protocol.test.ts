import assert from "node:assert/strict"
import { dirname, resolve } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import type { Configuration } from "electron-builder"
import { DebugLogger } from "builder-util"
import { LinuxTargetHelper } from "app-builder-lib/out/targets/LinuxTargetHelper"
import { validateConfiguration } from "app-builder-lib/out/util/config/config"
import { loadConfig } from "app-builder-lib/out/util/config/load"

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..")

async function loadElectronBuilderConfig(): Promise<Configuration> {
  const loaded = await loadConfig<Configuration>({
    configFilename: "electron-builder",
    packageKey: "build",
    packageMetadata: null,
    projectDir: repoRoot
  })

  assert.ok(loaded, "electron-builder config must exist")
  return loaded.result
}

test("Linux package owns the canonical jingle protocol desktop entry", async () => {
  const config = await loadElectronBuilderConfig()
  await validateConfiguration(config, new DebugLogger(false))

  assert.equal(config.protocols, undefined)
  assert.equal(config.win?.protocols, undefined)
  assert.equal(config.linux?.mimeTypes, undefined)
  assert.deepEqual(config.linux?.protocols, [
    {
      name: "Jingle OAuth Callback",
      schemes: ["jingle"]
    }
  ])

  const helper = new LinuxTargetHelper({
    appInfo: {
      description: "Jingle desktop package protocol probe",
      productName: "Jingle",
      sanitizedProductName: "Jingle"
    },
    config: {
      protocols: []
    },
    executableName: "jingle",
    fileAssociations: [],
    platformSpecificBuildOptions: config.linux
  } as never)
  const desktopEntry = await helper.computeDesktopEntry(
    { category: config.linux?.category },
    "/opt/Jingle/jingle"
  )

  assert.equal(
    desktopEntry.split("\n").filter((line) => line === "MimeType=x-scheme-handler/jingle;").length,
    1
  )
})
