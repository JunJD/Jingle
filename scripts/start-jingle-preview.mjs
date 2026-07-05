import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join, resolve } from "node:path"
import { runLocalCommand } from "./lib/run-local-command.mjs"

const APP_DISPLAY_NAME = "Jingle"
const APP_BUNDLE_ID = "com.jingle.desktop.dev"
const WINDOWS_EXECUTABLE_NAME = `${APP_DISPLAY_NAME}.exe`
const EJECTED_BUNDLE_ROOT = resolve(".jingle-build", "jingle-electron-preview")
const require = createRequire(import.meta.url)

function joinElectronDistPath(electronModuleDir, executablePath) {
  return join(electronModuleDir, "dist", ...executablePath.split(/[\\/]+/))
}

function readElectronExecutablePath() {
  const electronModuleDir = dirname(require.resolve("electron"))
  const executablePath = readFileSync(join(electronModuleDir, "path.txt"), "utf8").trim()
  if (!executablePath) {
    throw new Error("Electron executable path is empty.")
  }

  return {
    electronModuleDir,
    executablePath
  }
}

function readElectronPackageVersion(electronModuleDir) {
  const packageJson = JSON.parse(readFileSync(join(electronModuleDir, "package.json"), "utf8"))
  if (typeof packageJson.version !== "string") {
    throw new Error("Electron package version is missing.")
  }

  return packageJson.version
}

function replacePlistString(content, key, value) {
  const escapedValue = value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
  const pattern = new RegExp(`(<key>${key}</key>\\s*<string>)([^<]*)(</string>)`)
  if (!pattern.test(content)) {
    throw new Error(`Cannot find ${key} in Electron Info.plist.`)
  }

  return content.replace(pattern, `$1${escapedValue}$3`)
}

function readTextFile(path) {
  try {
    return readFileSync(path, "utf8")
  } catch {
    return null
  }
}

function createJingleMacOSPreviewExecutable(electronModuleDir) {
  const sourceBundle = join(electronModuleDir, "dist", "Electron.app")
  const targetBundle = join(EJECTED_BUNDLE_ROOT, `${APP_DISPLAY_NAME}.app`)
  const targetExecutable = join(targetBundle, "Contents", "MacOS", "Electron")
  const metadataPath = join(EJECTED_BUNDLE_ROOT, "metadata.json")
  const metadata = `${JSON.stringify(
    {
      appBundleId: APP_BUNDLE_ID,
      appDisplayName: APP_DISPLAY_NAME,
      electronVersion: readElectronPackageVersion(electronModuleDir),
      sourceBundle
    },
    null,
    2
  )}\n`

  if (!existsSync(sourceBundle)) {
    throw new Error(`Electron app bundle not found: ${sourceBundle}`)
  }

  if (!existsSync(targetExecutable) || readTextFile(metadataPath) !== metadata) {
    rmSync(targetBundle, { force: true, recursive: true })
    mkdirSync(EJECTED_BUNDLE_ROOT, { recursive: true })
    cpSync(sourceBundle, targetBundle, { recursive: true })
    writeFileSync(metadataPath, metadata)
  }

  const plistPath = join(targetBundle, "Contents", "Info.plist")
  let plist = readFileSync(plistPath, "utf8")
  plist = replacePlistString(plist, "CFBundleDisplayName", APP_DISPLAY_NAME)
  plist = replacePlistString(plist, "CFBundleName", APP_DISPLAY_NAME)
  plist = replacePlistString(plist, "CFBundleIdentifier", APP_BUNDLE_ID)
  writeFileSync(plistPath, plist)

  return targetExecutable
}

function createJingleWindowsPreviewExecutable(electronModuleDir, executablePath) {
  const sourceExecutable = joinElectronDistPath(electronModuleDir, executablePath)
  const sourceDist = join(electronModuleDir, "dist")
  const targetDist = join(EJECTED_BUNDLE_ROOT, "win32")
  const targetExecutable = join(targetDist, WINDOWS_EXECUTABLE_NAME)
  const metadataPath = join(EJECTED_BUNDLE_ROOT, "win32-metadata.json")
  const metadata = `${JSON.stringify(
    {
      appDisplayName: APP_DISPLAY_NAME,
      electronVersion: readElectronPackageVersion(electronModuleDir),
      sourceDist,
      windowsExecutableName: WINDOWS_EXECUTABLE_NAME
    },
    null,
    2
  )}\n`

  if (!existsSync(sourceExecutable)) {
    throw new Error(`Electron executable not found: ${sourceExecutable}`)
  }

  if (!existsSync(targetExecutable) || readTextFile(metadataPath) !== metadata) {
    rmSync(targetDist, { force: true, recursive: true })
    mkdirSync(EJECTED_BUNDLE_ROOT, { recursive: true })
    cpSync(sourceDist, targetDist, { recursive: true })

    const copiedExecutable = join(targetDist, ...executablePath.split(/[\\/]+/))
    if (copiedExecutable !== targetExecutable) {
      rmSync(targetExecutable, { force: true })
      renameSync(copiedExecutable, targetExecutable)
    }
    writeFileSync(metadataPath, metadata)
  }

  return targetExecutable
}

function createJingleElectronPreviewExecutable() {
  const { electronModuleDir, executablePath } = readElectronExecutablePath()

  if (process.platform === "darwin") {
    return createJingleMacOSPreviewExecutable(electronModuleDir)
  }

  if (process.platform === "win32") {
    return createJingleWindowsPreviewExecutable(electronModuleDir, executablePath)
  }

  return joinElectronDistPath(electronModuleDir, executablePath)
}

async function main() {
  const previewExecutablePath = createJingleElectronPreviewExecutable()
  if (process.argv.includes("--print-executable")) {
    console.log(previewExecutablePath)
    return
  }

  await runLocalCommand(
    "node",
    [
      "scripts/run-with-env.mjs",
      `JINGLE_REGISTER_DEV_PROTOCOL_CLIENT=1`,
      `ELECTRON_EXEC_PATH=${previewExecutablePath}`,
      "--",
      "node",
      "scripts/run-with-dotenv.mjs",
      "production",
      "--",
      "electron-vite",
      "preview"
    ],
    {
      env: process.env
    }
  )
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
