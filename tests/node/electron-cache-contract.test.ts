import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import {
  resolveElectronBuilderCacheDirectory,
  resolveElectronGetCacheDirectory,
  restoreVerifiedElectronBuilderCache
} from "../../scripts/electron-cache-contract.mjs"

test("restores checksum-verified Electron archives into each builder cache", () => {
  for (const [platform, environment] of [
    ["darwin", {}],
    ["linux", { XDG_CACHE_HOME: "cache-root" }],
    ["win32", { LOCALAPPDATA: "cache-root" }]
  ] as const) {
    const root = mkdtempSync(join(tmpdir(), `jingle-electron-cache-${platform}-`))
    const electronPackageRoot = join(root, "node_modules", "electron")
    const resolvedEnvironment = Object.fromEntries(
      Object.entries(environment).map(([key, value]) => [key, join(root, value)])
    )
    resolvedEnvironment.electron_config_cache = join(root, "electron-get-cache")
    resolvedEnvironment.ELECTRON_CACHE = join(root, "electron-builder-cache")
    const sourceCacheDir = resolveElectronGetCacheDirectory(platform, resolvedEnvironment, root)
    const builderCacheDir = resolveElectronBuilderCacheDirectory(
      platform,
      resolvedEnvironment,
      root
    )
    const platformName = platform === "darwin" ? "darwin" : platform
    const zipName = `electron-v39.8.3-${platformName}-x64.zip`
    const archive = Buffer.from(`verified-${platform}`)
    const checksum = createHash("sha256").update(archive).digest("hex")
    try {
      mkdirSync(electronPackageRoot, { recursive: true })
      writeFileSync(
        join(electronPackageRoot, "package.json"),
        JSON.stringify({ version: "39.8.3" })
      )
      writeFileSync(
        join(electronPackageRoot, "checksums.json"),
        JSON.stringify({ [zipName]: checksum })
      )
      const verifiedPath = join(sourceCacheDir, "verified-url-hash", zipName)
      mkdirSync(join(verifiedPath, ".."), { recursive: true })
      writeFileSync(verifiedPath, archive)
      mkdirSync(builderCacheDir, { recursive: true })
      writeFileSync(join(builderCacheDir, zipName), "corrupt")

      const [result] = restoreVerifiedElectronBuilderCache({
        archs: ["x64"],
        electronPackageRoot,
        environment: resolvedEnvironment,
        home: root,
        platform
      })
      assert.equal(result.restored, true)
      assert.equal(result.cachePath, join(builderCacheDir, zipName))
      assert.deepEqual(readFileSync(result.cachePath), archive)

      const [cachedResult] = restoreVerifiedElectronBuilderCache({
        archs: ["x64"],
        electronPackageRoot,
        environment: resolvedEnvironment,
        home: root,
        platform
      })
      assert.equal(cachedResult.restored, false)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  }
})

test("fails before builder when dependency installation left no verified Electron archive", () => {
  const root = mkdtempSync(join(tmpdir(), "jingle-electron-cache-missing-"))
  const electronPackageRoot = join(root, "electron")
  const zipName = "electron-v39.8.3-linux-x64.zip"
  try {
    mkdirSync(electronPackageRoot, { recursive: true })
    writeFileSync(join(electronPackageRoot, "package.json"), JSON.stringify({ version: "39.8.3" }))
    writeFileSync(
      join(electronPackageRoot, "checksums.json"),
      JSON.stringify({ [zipName]: "0".repeat(64) })
    )
    assert.throws(
      () =>
        restoreVerifiedElectronBuilderCache({
          archs: ["x64"],
          electronPackageRoot,
          environment: { XDG_CACHE_HOME: join(root, "cache") },
          home: root,
          platform: "linux"
        }),
      /Verified Electron cache is missing after dependency installation/
    )
    assert.equal(existsSync(join(root, "cache", "electron", zipName)), false)
  } finally {
    rmSync(root, { force: true, recursive: true })
  }
})

test("release workflow persists Electron distributions across exact dependency runs", () => {
  const workflow = readFileSync(".github/workflows/desktop-release.yml", "utf8")
  assert.match(workflow, /actions\/cache@55cc8345863c7cc4c66a329aec7e433d2d1c52a9/)
  assert.match(workflow, /~\/\.cache\/electron/)
  assert.match(workflow, /~\/Library\/Caches\/electron/)
  assert.match(workflow, /~\/AppData\/Local\/electron\/Cache/)
  assert.match(
    workflow,
    /electron-\$\{\{ runner\.os \}\}-\$\{\{ runner\.arch \}\}-\$\{\{ hashFiles\('pnpm-lock\.yaml'\) \}\}/
  )
})
