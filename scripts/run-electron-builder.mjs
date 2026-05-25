import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { copyFileSync, existsSync, readFileSync, readdirSync, rmSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

const args = process.argv.slice(2)

if (args.length === 0) {
  throw new Error("Usage: node scripts/run-electron-builder.mjs <electron-builder args...>")
}

function hasMacTarget(args) {
  return args.some((arg) => arg === "--mac" || arg === "-m")
}

function getMacTargetArchs(args) {
  const archs = new Set()

  if (args.some((arg) => arg === "--universal" || arg === "universal")) {
    archs.add("x64")
    archs.add("arm64")
  }

  if (args.some((arg) => arg === "--x64" || arg === "x64")) {
    archs.add("x64")
  }

  if (args.some((arg) => arg === "--arm64" || arg === "arm64")) {
    archs.add("arm64")
  }

  if (archs.size === 0) {
    archs.add(process.arch === "arm64" ? "arm64" : "x64")
  }

  return [...archs]
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex")
}

function findVerifiedElectronCache(cacheDir, zipName, expected, defaultCachePath) {
  for (const entryName of readdirSync(cacheDir, { withFileTypes: true })) {
    if (!entryName.isDirectory()) {
      continue
    }

    const candidate = join(cacheDir, entryName.name, zipName)
    if (candidate !== defaultCachePath && existsSync(candidate) && sha256(candidate) === expected) {
      return candidate
    }
  }

  return null
}

function repairDefaultElectronCache(args) {
  if (process.platform !== "darwin" || !hasMacTarget(args)) {
    return
  }

  const electronPackageJsonPath = join(process.cwd(), "node_modules", "electron", "package.json")
  const checksumsPath = join(process.cwd(), "node_modules", "electron", "checksums.json")
  if (!existsSync(electronPackageJsonPath) || !existsSync(checksumsPath)) {
    return
  }

  const electronPackageJson = JSON.parse(readFileSync(electronPackageJsonPath, "utf-8"))
  const checksums = JSON.parse(readFileSync(checksumsPath, "utf-8"))

  for (const arch of getMacTargetArchs(args)) {
    const zipName = `electron-v${electronPackageJson.version}-darwin-${arch}.zip`
    const expected = checksums[zipName]
    const cacheDir = join(homedir(), "Library", "Caches", "electron")
    const cachePath = join(cacheDir, zipName)
    if (!expected) {
      continue
    }

    if (existsSync(cachePath) && sha256(cachePath) === expected) {
      continue
    }

    const verifiedCachePath = existsSync(cacheDir)
      ? findVerifiedElectronCache(cacheDir, zipName, expected, cachePath)
      : null
    if (verifiedCachePath) {
      copyFileSync(verifiedCachePath, cachePath)
      console.warn(`[electron-builder] restored Electron cache from ${verifiedCachePath}`)
      continue
    }

    rmSync(cachePath, { force: true })
    console.warn(`[electron-builder] removed corrupt Electron cache: ${cachePath}`)
  }
}

repairDefaultElectronCache(args)

let receivedSignal = false

const command = process.platform === "win32" ? "npm.cmd" : "npm"
const child = spawn(command, ["exec", "--", "electron-builder", ...args], {
  cwd: process.cwd(),
  env: process.env,
  stdio: "inherit"
})

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    receivedSignal = true
    process.exitCode = signal === "SIGINT" ? 130 : 143
    child.kill(signal)
  })
}

child.on("error", (error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})

child.on("close", (code) => {
  if (receivedSignal) {
    return
  }

  process.exitCode = code ?? 1
})
