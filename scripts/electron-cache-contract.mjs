import { createHash } from "node:crypto"
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex")
}

function resolveDefaultElectronCacheDirectory(
  platform = process.platform,
  environment = process.env,
  home = homedir()
) {
  if (platform === "darwin") return join(home, "Library", "Caches", "electron")
  if (platform === "win32") {
    return join(environment.LOCALAPPDATA || join(home, "AppData", "Local"), "electron", "Cache")
  }
  return join(environment.XDG_CACHE_HOME || join(home, ".cache"), "electron")
}

export function resolveElectronGetCacheDirectory(
  platform = process.platform,
  environment = process.env,
  home = homedir()
) {
  return (
    environment.electron_config_cache ||
    resolveDefaultElectronCacheDirectory(platform, environment, home)
  )
}

export function resolveElectronBuilderCacheDirectory(
  platform = process.platform,
  environment = process.env,
  home = homedir()
) {
  return (
    environment.ELECTRON_CACHE || resolveDefaultElectronCacheDirectory(platform, environment, home)
  )
}

function findVerifiedElectronCache(cacheDir, zipName, expected, defaultCachePath) {
  if (!existsSync(cacheDir)) return null
  for (const entryName of readdirSync(cacheDir, { withFileTypes: true })) {
    if (!entryName.isDirectory()) continue
    const candidate = join(cacheDir, entryName.name, zipName)
    if (candidate !== defaultCachePath && existsSync(candidate) && sha256(candidate) === expected) {
      return candidate
    }
  }
  return null
}

export function restoreVerifiedElectronBuilderCache(options) {
  const platformName =
    options.platform === "darwin"
      ? "darwin"
      : options.platform === "win32"
        ? "win32"
        : options.platform === "linux"
          ? "linux"
          : null
  if (!platformName) throw new Error(`Unsupported Electron cache platform: ${options.platform}`)

  const electronPackageJson = JSON.parse(
    readFileSync(join(options.electronPackageRoot, "package.json"), "utf8")
  )
  const checksums = JSON.parse(
    readFileSync(join(options.electronPackageRoot, "checksums.json"), "utf8")
  )
  const sourceCacheDir = resolveElectronGetCacheDirectory(
    options.platform,
    options.environment,
    options.home
  )
  const builderCacheDir = resolveElectronBuilderCacheDirectory(
    options.platform,
    options.environment,
    options.home
  )
  mkdirSync(builderCacheDir, { recursive: true })

  return options.archs.map((arch) => {
    const zipName = `electron-v${electronPackageJson.version}-${platformName}-${arch}.zip`
    const expected = checksums[zipName]
    if (typeof expected !== "string" || !/^[a-f0-9]{64}$/.test(expected)) {
      throw new Error(`Electron checksum is unavailable for ${zipName}`)
    }
    const cachePath = join(builderCacheDir, zipName)
    if (existsSync(cachePath) && sha256(cachePath) === expected) {
      return { cachePath, restored: false, zipName }
    }

    const verifiedCachePath = findVerifiedElectronCache(
      sourceCacheDir,
      zipName,
      expected,
      cachePath
    )
    rmSync(cachePath, { force: true })
    if (!verifiedCachePath) {
      throw new Error(
        `Verified Electron cache is missing after dependency installation: ${zipName}`
      )
    }
    copyFileSync(verifiedCachePath, cachePath)
    return { cachePath, restored: true, zipName }
  })
}
