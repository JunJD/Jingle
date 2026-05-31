const { spawnSync } = require("node:child_process")
const { existsSync, lstatSync, readdirSync, rmSync } = require("node:fs")
const { join, resolve } = require("node:path")

const retainedElectronLocalePrefixes = ["en", "en_GB", "zh_CN", "zh_TW"]

function toMiB(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function sizeOf(path) {
  const entry = lstatSync(path)
  if (!entry.isDirectory()) {
    return entry.size
  }

  let total = entry.size
  for (const child of readdirSync(path)) {
    total += sizeOf(join(path, child))
  }
  return total
}

function shouldKeepElectronLocale(entryName) {
  if (!entryName.endsWith(".lproj")) {
    return true
  }

  const localeName = entryName.slice(0, -".lproj".length)
  return retainedElectronLocalePrefixes.some((localePrefix) => {
    return localeName === localePrefix || localeName.startsWith(`${localePrefix}_`)
  })
}

function findMacAppPath(appOutDir) {
  if (appOutDir.endsWith(".app")) {
    return appOutDir
  }

  for (const entryName of readdirSync(appOutDir)) {
    if (entryName.endsWith(".app")) {
      return join(appOutDir, entryName)
    }
  }

  return null
}

function pruneMacElectronLocales(appOutDir) {
  const appPath = findMacAppPath(appOutDir)
  if (!appPath) {
    return
  }

  const electronFrameworkResourcesPath = join(
    appPath,
    "Contents",
    "Frameworks",
    "Electron Framework.framework",
    "Versions",
    "A",
    "Resources"
  )
  if (!existsSync(electronFrameworkResourcesPath)) {
    return
  }

  let keptCount = 0
  let removedCount = 0
  let removedBytes = 0
  for (const entryName of readdirSync(electronFrameworkResourcesPath)) {
    if (!entryName.endsWith(".lproj")) {
      continue
    }

    const entryPath = join(electronFrameworkResourcesPath, entryName)
    if (shouldKeepElectronLocale(entryName)) {
      keptCount += 1
      continue
    }

    removedBytes += sizeOf(entryPath)
    rmSync(entryPath, { force: true, recursive: true })
    removedCount += 1
  }

  console.log(
    `[afterPack] pruned ${removedCount} Electron Framework locale directories (${toMiB(removedBytes)}), kept ${keptCount}`
  )
}

exports.default = function afterPack(context) {
  if (context.electronPlatformName === "darwin") {
    pruneMacElectronLocales(context.appOutDir)
  }

  const auditScriptPath = resolve(__dirname, "audit-packaged-runtime.mjs")
  const result = spawnSync(process.execPath, [auditScriptPath, context.appOutDir], {
    cwd: join(__dirname, ".."),
    env: process.env,
    stdio: "inherit"
  })

  if (result.error) {
    throw result.error
  }

  if (result.status !== 0) {
    throw new Error(`Packaged runtime audit failed for ${context.appOutDir}`)
  }
}
