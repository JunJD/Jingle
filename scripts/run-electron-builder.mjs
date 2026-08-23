import { execFileSync, spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { copyFileSync, existsSync, readFileSync, readdirSync, rmSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { assertElectronBuilderNsisContract } from "./electron-builder-nsis-contract.mjs"

const args = process.argv.slice(2)

if (args.length === 0) {
  throw new Error("Usage: node scripts/run-electron-builder.mjs <electron-builder args...>")
}

const nsisContract = assertElectronBuilderNsisContract()
console.log(`[electron-builder] verified NSIS contract ${JSON.stringify(nsisContract.versions)}`)

function hasMacTarget(args) {
  return args.some((arg) => arg === "--mac" || arg === "-m")
}

function hasTarget(args, longName, shortName) {
  return args.some((arg) => arg === longName || arg === shortName)
}

function getPackagedAuditGroups(args) {
  const distRoot = join(process.cwd(), "dist")
  const groups = []
  const archs = getTargetArchs(args)
  if (hasTarget(args, "--win", "-w")) {
    for (const arch of archs) {
      groups.push({
        candidates: [join(distRoot, arch === "x64" ? "win-unpacked" : `win-${arch}-unpacked`)],
        label: `win32-${arch}`
      })
    }
  }
  if (hasTarget(args, "--linux", "-l")) {
    for (const arch of archs) {
      groups.push({
        candidates: [join(distRoot, arch === "x64" ? "linux-unpacked" : `linux-${arch}-unpacked`)],
        label: `linux-${arch}`
      })
    }
  }
  if (hasMacTarget(args)) {
    if (args.some((arg) => arg === "--universal" || arg === "universal")) {
      groups.push({ candidates: [join(distRoot, "mac-universal")], label: "darwin-universal" })
    } else {
      for (const arch of archs) {
        groups.push({
          candidates:
            arch === "x64"
              ? [join(distRoot, "mac-x64"), join(distRoot, "mac")]
              : [join(distRoot, `mac-${arch}`)],
          label: `darwin-${arch}`
        })
      }
    }
  }
  return groups
}

function resetPackagedAuditRoots(args) {
  const candidates = getPackagedAuditGroups(args).flatMap((group) => group.candidates)
  for (const candidate of new Set(candidates)) {
    rmSync(candidate, { force: true, recursive: true })
  }
}

function getPackagedAuditRoots(args) {
  const groups = getPackagedAuditGroups(args)
  const missingGroups = groups.filter(
    (group) => !group.candidates.some((candidate) => existsSync(candidate))
  )
  if (missingGroups.length > 0) {
    throw new Error(
      `electron-builder did not produce requested unpacked roots: ${missingGroups.map((group) => group.label).join(", ")}`
    )
  }
  return groups.flatMap((group) => group.candidates.filter((candidate) => existsSync(candidate)))
}

function auditPackagedOutputs(args) {
  const roots = getPackagedAuditRoots(args)
  if (roots.length === 0) {
    throw new Error("electron-builder produced no unpacked application root to audit")
  }
  const auditScriptPath = join(process.cwd(), "scripts", "audit-packaged-runtime.mjs")
  for (const root of roots) {
    execFileSync(process.execPath, [auditScriptPath, root], {
      cwd: process.cwd(),
      env: process.env,
      stdio: "inherit",
      timeout: 180_000
    })
  }
}

function getTargetArchs(args) {
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
    const declaredArch = process.env.JINGLE_BUILD_TARGET_ARCH
    archs.add(
      declaredArch === "arm64" || declaredArch === "x64"
        ? declaredArch
        : process.arch === "arm64"
          ? "arm64"
          : "x64"
    )
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

  for (const arch of getTargetArchs(args)) {
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
resetPackagedAuditRoots(args)

let receivedSignal = false

const command = process.platform === "win32" ? "npm.cmd" : "npm"
const child = spawn(command, ["exec", "--", "electron-builder", ...args], {
  cwd: process.cwd(),
  env: process.env,
  shell: process.platform === "win32",
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

  if (code !== 0) {
    process.exitCode = code ?? 1
    return
  }
  try {
    auditPackagedOutputs(args)
    process.exitCode = 0
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
})
