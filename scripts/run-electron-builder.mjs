import { spawn } from "node:child_process"
import { copyFileSync, existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const args = process.argv.slice(2)

if (args.length === 0) {
  throw new Error("Usage: node scripts/run-electron-builder.mjs <electron-builder args...>")
}

const packageJsonPath = join(process.cwd(), "package.json")
const packageJsonBackupPath = join(process.cwd(), "package.json.openwork-desktop-release-backup")
const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"))

delete packageJson.dependencies?.electron
copyFileSync(packageJsonPath, packageJsonBackupPath)
writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + "\n")

let packageJsonRestored = false
let receivedSignal = false

function restorePackageJson() {
  if (packageJsonRestored || !existsSync(packageJsonBackupPath)) {
    return
  }

  renameSync(packageJsonBackupPath, packageJsonPath)
  packageJsonRestored = true
}

const command = process.platform === "win32" ? "npm.cmd" : "npm"
const child = spawn(command, ["exec", "--", "electron-builder", ...args], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    ALLOW_ELECTRON_BUILDER_AS_PRODUCTION_DEPENDENCY: "true"
  },
  stdio: "inherit"
})

process.on("exit", restorePackageJson)

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    receivedSignal = true
    process.exitCode = signal === "SIGINT" ? 130 : 143
    child.kill(signal)
  })
}

child.on("error", (error) => {
  restorePackageJson()
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})

child.on("close", (code) => {
  restorePackageJson()
  rmSync(packageJsonBackupPath, { force: true })
  if (receivedSignal) {
    return
  }

  process.exitCode = code ?? 1
})
