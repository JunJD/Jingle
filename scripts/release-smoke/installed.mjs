#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process"
import { createHash, randomUUID } from "node:crypto"
import {
  appendFileSync,
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs"
import { tmpdir } from "node:os"
import { basename, join, relative, resolve } from "node:path"
import { createServer } from "node:net"
import { pathToFileURL } from "node:url"
import { PrismaClient } from "@prisma/client"
import { chromium } from "playwright"
import { readMigrationManifest } from "./migration-manifest.mjs"
import {
  downloadUpgradeAsset,
  prepareUpgradeBaseline,
  readUpgradeBaseline
} from "./upgrade-baseline.mjs"

const APP_BOOT_TIMEOUT_MS = 90_000
const PROCESS_TIMEOUT_MS = 120_000
const currentPackageVersion = JSON.parse(readFileSync(resolve("package.json"), "utf8")).version
const packageSuffixByPlatform = {
  darwin: ".dmg",
  linux: ".AppImage",
  win32: ".exe"
}
const requiredMigrations = readMigrationManifest()

function fail(message) {
  throw new Error(`Installed release smoke: ${message}`)
}

export function assertUpgradeSentinelThread(thread, sentinel, owner) {
  const marker =
    thread && typeof thread === "object" && thread.metadata && typeof thread.metadata === "object"
      ? thread.metadata.releaseSmokeUpgradeSentinel
      : null
  if (
    !thread ||
    typeof thread !== "object" ||
    typeof thread.threadId !== "string" ||
    thread.threadId.length === 0 ||
    (sentinel.threadId !== undefined &&
      sentinel.threadId !== null &&
      thread.threadId !== sentinel.threadId) ||
    thread.title !== sentinel.title ||
    !marker ||
    typeof marker !== "object" ||
    Object.keys(marker).sort().join(",") !== "schemaVersion,sourceVersion,token" ||
    marker.schemaVersion !== 1 ||
    marker.sourceVersion !== "0.0.1" ||
    marker.token !== sentinel.token
  ) {
    fail(`${owner} returned an invalid upgrade sentinel: ${JSON.stringify(thread)}`)
  }
  return thread
}

function readArgument(name, fallback = null) {
  const index = process.argv.indexOf(name)
  if (index === -1) {
    return fallback
  }
  if (index + 1 >= process.argv.length) {
    fail(`missing value for ${name}`)
  }
  return process.argv[index + 1]
}

function collectFiles(root, predicate, matches = []) {
  if (!existsSync(root)) {
    return matches
  }
  const entry = statSync(root)
  if (entry.isFile()) {
    if (predicate(root)) matches.push(root)
    return matches
  }
  for (const child of readdirSync(root).sort()) {
    collectFiles(join(root, child), predicate, matches)
  }
  return matches
}

export function selectInstallerArtifact(root, platform = process.platform) {
  const suffix = packageSuffixByPlatform[platform]
  if (!suffix) fail(`unsupported platform '${platform}'`)
  const artifactRoot = resolve(root)
  const matches = existsSync(artifactRoot)
    ? readdirSync(artifactRoot, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith(suffix))
        .map((entry) => join(artifactRoot, entry.name))
        .sort()
    : []
  if (matches.length !== 1) {
    fail(
      `expected exactly one top-level ${suffix} package under ${artifactRoot}, found ${matches.length}`
    )
  }
  return matches[0]
}

export function createInstallerInvocation(platform, artifactPath, installRoot) {
  if (platform === "darwin") {
    return { kind: "dmg", artifactPath, installRoot }
  }
  if (platform === "linux") {
    return { kind: "appimage", artifactPath, installRoot }
  }
  if (platform === "win32") {
    if (/[\r\n\0]/.test(artifactPath) || /[\r\n\0]/.test(installRoot)) {
      fail("Windows installer path contains an invalid character")
    }
    return {
      args: ["/S", `/D=${installRoot}`],
      command: artifactPath,
      installRoot,
      kind: "nsis",
      windowsVerbatimArguments: true
    }
  }
  fail(`unsupported platform '${platform}'`)
}

export function createUpgradeInstallMode(platform = process.platform) {
  if (!packageSuffixByPlatform[platform]) fail(`unsupported platform '${platform}'`)
  return platform === "win32" ? "nsis-in-place" : "data-only-reinstall"
}

export function createWindowsPayloadInventory(root) {
  const resolvedRoot = resolve(root)
  const files = collectFiles(resolvedRoot, (path) => statSync(path).isFile()).sort()
  const uninstallers = files.filter(
    (path) => basename(path).toLowerCase().startsWith("uninstall") && path.endsWith(".exe")
  )
  if (uninstallers.length !== 1) {
    fail(`expected exactly one Windows uninstaller, found ${uninstallers.length}`)
  }
  return {
    payload: files
      .filter((path) => path !== uninstallers[0])
      .map((path) => ({
        path: relative(resolvedRoot, path).replaceAll("\\", "/"),
        sha256: createHash("sha256").update(readFileSync(path)).digest("hex"),
        size: statSync(path).size
      })),
    uninstaller: {
      path: relative(resolvedRoot, uninstallers[0]).replaceAll("\\", "/"),
      sha256: createHash("sha256").update(readFileSync(uninstallers[0])).digest("hex"),
      size: statSync(uninstallers[0]).size
    }
  }
}

export function assertWindowsPayloadMatchesFreshInstall(expected, actual) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail("Windows in-place upgrade payload differs from a fresh current installation")
  }
  return actual
}

export function selectMountedMacApp(mountPath) {
  const topLevelApps = readdirSync(mountPath, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.name.endsWith(".app") &&
        (entry.isDirectory() || entry.isSymbolicLink()) &&
        existsSync(join(mountPath, entry.name, "Contents", "Info.plist"))
    )
    .map((entry) => join(mountPath, entry.name))
  if (topLevelApps.length !== 1) {
    fail(`expected exactly one top-level app in the DMG, found ${topLevelApps.length}`)
  }
  return topLevelApps[0]
}

export function runProcess(command, args, options) {
  const { cwd, env = process.env, logPath, timeoutMs = PROCESS_TIMEOUT_MS } = options
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      shell: false,
      windowsHide: true,
      windowsVerbatimArguments: options.windowsVerbatimArguments === true
    })
    let settled = false
    let stderr = ""
    let stdout = ""
    const timer = setTimeout(async () => {
      if (settled) return
      settled = true
      const timeoutError = new Error(`${basename(command)} timed out after ${timeoutMs} ms`)
      try {
        await terminateProcessTree(child.pid)
        reject(timeoutError)
      } catch (cleanupError) {
        reject(new AggregateError([timeoutError, cleanupError], "Process timeout cleanup failed"))
      }
    }, timeoutMs)

    function record(stream, chunk) {
      appendFileSync(logPath, `[${stream}] ${chunk}`)
      if (stream === "stdout") stdout += chunk
      else stderr += chunk
    }

    function finish(error) {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error) reject(error)
      else resolvePromise({ stderr, stdout })
    }

    child.stdout?.on("data", (chunk) => record("stdout", chunk))
    child.stderr?.on("data", (chunk) => record("stderr", chunk))
    child.once("error", finish)
    child.once("close", (code, signal) => {
      if (code === 0) {
        finish()
        return
      }
      finish(
        new Error(`${basename(command)} exited with code ${String(code)} signal ${String(signal)}`)
      )
    })
  })
}

export function createLinuxXdgEnvironment(root) {
  const home = join(root, "home")
  const environment = {
    HOME: home,
    XDG_CACHE_HOME: join(home, ".cache"),
    XDG_CONFIG_HOME: join(home, ".config"),
    XDG_DATA_HOME: join(home, ".local", "share"),
    XDG_RUNTIME_DIR: join(root, "runtime"),
    XDG_STATE_HOME: join(home, ".local", "state")
  }
  for (const path of Object.values(environment)) {
    mkdirSync(path, { recursive: true })
  }
  chmodSync(environment.XDG_RUNTIME_DIR, 0o700)
  return environment
}

export function selectLinuxDesktopEntry(appRoot) {
  const candidates = collectFiles(appRoot, (path) => path.endsWith(".desktop"))
  const matches = candidates.filter((path) => {
    const mimeLine = readFileSync(path, "utf8")
      .split(/\r?\n/)
      .find((line) => line.startsWith("MimeType="))
    return mimeLine?.slice("MimeType=".length).split(";").includes("x-scheme-handler/jingle")
  })
  if (matches.length !== 1) {
    fail(`expected exactly one Linux desktop entry for jingle, found ${matches.length}`)
  }
  return matches[0]
}

export function assertLinuxProtocolHandler(output, desktopEntryName) {
  const registeredDesktopEntry = output.trim()
  if (registeredDesktopEntry !== desktopEntryName) {
    fail(
      `expected x-scheme-handler/jingle to use ${desktopEntryName}, got '${registeredDesktopEntry}'`
    )
  }
  return registeredDesktopEntry
}

export function assertLinuxDesktopEntryLaunch(source) {
  const execLine = source.split(/\r?\n/).find((line) => line.startsWith("Exec="))
  if (execLine !== "Exec=AppRun --no-sandbox %U") {
    fail(`packaged Linux desktop entry has an invalid launch command: ${String(execLine)}`)
  }
  return execLine
}

export function assertMacProtocolDeclaration(value) {
  const schemes = Array.isArray(value)
    ? value.flatMap((entry) =>
        Array.isArray(entry?.CFBundleURLSchemes) ? entry.CFBundleURLSchemes : []
      )
    : []
  if (!schemes.includes("jingle")) {
    fail("macOS application does not declare the jingle URL scheme")
  }
  return schemes
}

export function assertWindowsProtocolCommand(command, executablePath) {
  const trimmed = command.trim()
  let registeredExecutable
  let argumentTemplate
  if (trimmed.startsWith('"')) {
    const closingQuote = trimmed.indexOf('"', 1)
    if (closingQuote <= 1) fail("Windows protocol command has invalid executable quoting")
    registeredExecutable = trimmed.slice(1, closingQuote)
    argumentTemplate = trimmed.slice(closingQuote + 1).trim()
  } else {
    const separator = trimmed.search(/\s/)
    registeredExecutable = separator === -1 ? trimmed : trimmed.slice(0, separator)
    argumentTemplate = separator === -1 ? "" : trimmed.slice(separator).trim()
  }

  const normalizeWindowsPath = (path) => resolve(path).toLowerCase().replaceAll("\\", "/")
  if (normalizeWindowsPath(registeredExecutable) !== normalizeWindowsPath(executablePath)) {
    fail("Windows jingle protocol registration does not target the installed executable")
  }
  if (argumentTemplate !== '"%1"' && argumentTemplate !== "%1") {
    fail("Windows jingle protocol registration has an invalid URL argument template")
  }
  return { argumentTemplate, executablePath: registeredExecutable }
}

export function ensureLinuxAppImageExecutable(artifactPath) {
  const artifactStats = statSync(artifactPath)
  if (!(artifactStats.mode & 0o111)) chmodSync(artifactPath, artifactStats.mode | 0o111)
  if (!(statSync(artifactPath).mode & 0o111))
    fail(`AppImage artifact is not executable: ${artifactPath}`)
}

async function terminateProcessTree(processId) {
  if (!processId || processId < 2) return
  let inspectionError = null
  let processIds = [processId]
  try {
    processIds = snapshotProcessTree(processId)
  } catch (error) {
    inspectionError = error
  }
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(processId), "/t", "/f"], {
      shell: false,
      stdio: "ignore",
      windowsHide: true
    })
  } else {
    for (const targetId of processIds) {
      try {
        process.kill(targetId, "SIGKILL")
      } catch {
        // The process already exited.
      }
    }
  }
  await waitForProcessExit(processIds, `process tree rooted at ${processId}`)
  if (inspectionError) throw inspectionError
}

function readProcessParentPairs() {
  if (process.platform === "win32") {
    const result = spawnSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId | ConvertTo-Json -Compress"
      ],
      { encoding: "utf8", shell: false, windowsHide: true }
    )
    if (result.status !== 0) fail("could not inspect the Windows process tree")
    const parsed = JSON.parse(result.stdout || "[]")
    return (Array.isArray(parsed) ? parsed : [parsed]).map((entry) => [
      Number(entry.ProcessId),
      Number(entry.ParentProcessId)
    ])
  }

  const result = spawnSync("ps", ["-axo", "pid=,ppid="], { encoding: "utf8" })
  if (result.status !== 0) fail("could not inspect the POSIX process tree")
  return result.stdout.split("\n").map((line) => {
    const [rawProcessId, rawParentId] = line.trim().split(/\s+/)
    return [Number(rawProcessId), Number(rawParentId)]
  })
}

function snapshotProcessTree(processId) {
  const childrenByParent = new Map()
  for (const [childId, parentId] of readProcessParentPairs()) {
    if (!Number.isSafeInteger(childId) || !Number.isSafeInteger(parentId)) continue
    const children = childrenByParent.get(parentId) ?? []
    children.push(childId)
    childrenByParent.set(parentId, children)
  }
  const ordered = []
  const visit = (parentId) => {
    for (const childId of childrenByParent.get(parentId) ?? []) {
      visit(childId)
      ordered.push(childId)
    }
  }
  visit(processId)
  ordered.push(processId)
  return ordered
}

async function waitForProcessExit(processIds, description) {
  if (processIds.length === 0) return
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    const running = processIds.filter((processId) => {
      try {
        process.kill(processId, 0)
        return true
      } catch {
        return false
      }
    })
    if (running.length === 0) return
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 50))
  }
  fail(`${description} did not confirm exit`)
}

function findSingle(root, predicate, description) {
  const matches = collectFiles(root, predicate)
  if (matches.length !== 1) {
    fail(`expected exactly one ${description} under ${root}, found ${matches.length}`)
  }
  return matches[0]
}

async function installMac(invocation, workspace, logPath) {
  const mountPath = join(workspace, "dmg-mount")
  const appPath = join(invocation.installRoot, "Jingle.app")
  mkdirSync(mountPath, { recursive: true })
  mkdirSync(invocation.installRoot, { recursive: true })
  await runProcess(
    "hdiutil",
    ["attach", invocation.artifactPath, "-readonly", "-nobrowse", "-mountpoint", mountPath],
    { cwd: workspace, logPath }
  )
  let installError = null
  try {
    const sourceApp = selectMountedMacApp(mountPath)
    await runProcess("ditto", [sourceApp, appPath], { cwd: workspace, logPath })
    const protocolDeclaration = await runProcess(
      "plutil",
      ["-extract", "CFBundleURLTypes", "json", "-o", "-", join(appPath, "Contents", "Info.plist")],
      { cwd: workspace, logPath }
    )
    assertMacProtocolDeclaration(JSON.parse(protocolDeclaration.stdout))
  } catch (error) {
    installError = error
  }
  let detachError = null
  try {
    await runProcess("hdiutil", ["detach", mountPath, "-force"], {
      cwd: workspace,
      logPath
    })
  } catch (error) {
    detachError = error
  }
  if (installError && detachError) {
    throw new AggregateError([installError, detachError], "DMG install and detach both failed")
  }
  if (installError) throw installError
  if (detachError) throw detachError
  return {
    appRoot: invocation.installRoot,
    executablePath: findSingle(
      join(appPath, "Contents", "MacOS"),
      (path) => Boolean(statSync(path).mode & 0o111),
      "macOS app executable"
    )
  }
}

async function installWindows(invocation, workspace, logPath) {
  mkdirSync(invocation.installRoot, { recursive: true })
  await runProcess(invocation.command, invocation.args, {
    cwd: workspace,
    logPath,
    windowsVerbatimArguments: invocation.windowsVerbatimArguments
  })
  const executablePath = findSingle(
    invocation.installRoot,
    (path) => basename(path).toLowerCase() === "jingle.exe",
    "installed Jingle.exe"
  )
  return { appRoot: invocation.installRoot, executablePath }
}

async function installLinux(invocation, workspace, logPath) {
  const extractRoot = join(invocation.installRoot, "extracted")
  ensureLinuxAppImageExecutable(invocation.artifactPath)
  mkdirSync(invocation.installRoot, { recursive: true })
  mkdirSync(extractRoot, { recursive: true })
  await runProcess(invocation.artifactPath, ["--appimage-extract"], {
    cwd: extractRoot,
    logPath
  })
  const appRoot = join(extractRoot, "squashfs-root")
  if (!existsSync(join(appRoot, "AppRun"))) fail(`AppImage extraction missed ${appRoot}/AppRun`)

  const requireProtocolEntry = invocation.requireProtocolEntry !== false
  const desktopEntrySource = requireProtocolEntry ? selectLinuxDesktopEntry(appRoot) : null
  if (desktopEntrySource) {
    assertLinuxDesktopEntryLaunch(readFileSync(desktopEntrySource, "utf8"))
  }
  const desktopEntryName = desktopEntrySource ? basename(desktopEntrySource) : null
  const launchEnvironment = createLinuxXdgEnvironment(join(invocation.installRoot, "xdg"))
  const environment = { ...process.env, ...launchEnvironment }
  let installedDesktopEntry = null
  if (desktopEntrySource && desktopEntryName) {
    const applicationsDirectory = join(launchEnvironment.XDG_DATA_HOME, "applications")
    mkdirSync(applicationsDirectory, { recursive: true })
    await runProcess(
      "desktop-file-install",
      [
        `--dir=${applicationsDirectory}`,
        "--set-key=Exec",
        `--set-value=${invocation.artifactPath} --no-sandbox %U`,
        desktopEntrySource
      ],
      { cwd: workspace, env: environment, logPath }
    )
    installedDesktopEntry = join(applicationsDirectory, desktopEntryName)
    await runProcess("desktop-file-validate", [installedDesktopEntry], {
      cwd: workspace,
      env: environment,
      logPath
    })
    await runProcess("update-desktop-database", [applicationsDirectory], {
      cwd: workspace,
      env: environment,
      logPath
    })
    await runProcess("xdg-mime", ["default", desktopEntryName, "x-scheme-handler/jingle"], {
      cwd: workspace,
      env: environment,
      logPath
    })
  }
  return {
    appRoot,
    desktopEntryPath: installedDesktopEntry,
    desktopEntryName,
    executablePath: invocation.artifactPath,
    launchArgs: ["--no-sandbox"],
    launchEnvironment
  }
}

async function installArtifact(invocation, workspace, logPath) {
  if (invocation.kind === "dmg") return installMac(invocation, workspace, logPath)
  if (invocation.kind === "nsis") return installWindows(invocation, workspace, logPath)
  return installLinux(invocation, workspace, logPath)
}

async function cleanupInstalledArtifact(input) {
  const { installRoot, installed, installationCompleted, logPath, workspace } = input
  const errors = []
  if (process.platform === "win32" && existsSync(installRoot)) {
    try {
      const uninstallers = collectFiles(
        installRoot,
        (path) => basename(path).toLowerCase().startsWith("uninstall") && path.endsWith(".exe")
      )
      if (uninstallers.length === 1) {
        await runProcess(uninstallers[0], ["/S", `_?=${installRoot}`], {
          cwd: workspace,
          logPath,
          windowsVerbatimArguments: true
        })
        if (installed?.executablePath && existsSync(installed.executablePath)) {
          fail("NSIS uninstall left the installed Jingle executable in place")
        }
        const remainingPayloadFiles = collectFiles(
          installRoot,
          (path) => statSync(path).isFile() && resolve(path) !== resolve(uninstallers[0])
        )
        if (remainingPayloadFiles.length > 0) {
          fail(`NSIS uninstall left ${remainingPayloadFiles.length} installed payload files`)
        }
      } else if (installationCompleted) {
        fail(`expected exactly one NSIS uninstaller, found ${uninstallers.length}`)
      } else if (uninstallers.length > 1) {
        fail(`expected at most one NSIS uninstaller, found ${uninstallers.length}`)
      }
    } catch (error) {
      errors.push(error)
    }
  }
  try {
    rmSync(installRoot, { force: true, recursive: true })
  } catch (error) {
    errors.push(error)
  }
  if (errors.length === 1) throw errors[0]
  if (errors.length > 1) {
    throw new AggregateError(errors, "Installed payload cleanup failed")
  }
}

async function withInstalledArtifact(input, operation) {
  let installed = null
  let installationCompleted = false
  let result
  let primaryError = null
  try {
    const invocation = createInstallerInvocation(
      process.platform,
      input.artifactPath,
      input.installRoot
    )
    invocation.requireProtocolEntry = input.requireProtocolEntry !== false
    installed = await installArtifact(invocation, input.workspace, input.logPath)
    installationCompleted = true
    result = await operation(installed)
  } catch (error) {
    primaryError = error
  }
  let cleanupError = null
  try {
    await cleanupInstalledArtifact({
      installRoot: input.installRoot,
      installed,
      installationCompleted,
      logPath: input.logPath,
      workspace: input.workspace
    })
  } catch (error) {
    cleanupError = error
  }
  if (primaryError && cleanupError) {
    throw new AggregateError([primaryError, cleanupError], "Installed operation and cleanup failed")
  }
  if (primaryError) throw primaryError
  if (cleanupError) throw cleanupError
  return result
}

export async function withWindowsInPlaceUpgrade(input, operations = {}) {
  const createInvocation = operations.createInvocation ?? createInstallerInvocation
  const install = operations.install ?? installArtifact
  const cleanup = operations.cleanup ?? cleanupInstalledArtifact
  let installed = null
  let installationCompleted = false
  let result
  let primaryError = null
  try {
    const previousInvocation = createInvocation(
      "win32",
      input.previousArtifactPath,
      input.installRoot
    )
    installed = await install(previousInvocation, input.workspace, input.logPath)
    installationCompleted = true
    const previousResult = await input.runPrevious(installed)

    await input.beforeCurrent()
    const currentInvocation = createInvocation(
      "win32",
      input.currentArtifactPath,
      input.installRoot
    )
    installed = await install(currentInvocation, input.workspace, input.logPath)
    const currentResult = await input.runCurrent(installed, previousResult)
    result = { currentResult, previousResult }
  } catch (error) {
    primaryError = error
  }

  let cleanupError = null
  try {
    await cleanup({
      installRoot: input.installRoot,
      installed,
      installationCompleted,
      logPath: input.logPath,
      workspace: input.workspace
    })
  } catch (error) {
    cleanupError = error
  }
  if (primaryError && cleanupError) {
    throw new AggregateError(
      [primaryError, cleanupError],
      "Windows in-place upgrade and cleanup failed"
    )
  }
  if (primaryError) throw primaryError
  if (cleanupError) throw cleanupError
  return result
}

function createLaunchEnvironment(jingleHome, overrides = {}) {
  const env = {
    ...process.env,
    ...overrides,
    CI: "1",
    JINGLE_HOME: jingleHome
  }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.ELECTRON_RENDERER_URL
  delete env.JINGLE_BDD
  delete env.JINGLE_BDD_AGENT_RUNTIME
  delete env.JINGLE_BDD_EXTENSION_RUNTIME_FIXTURES
  return env
}

export function createRemoteDebuggingLaunchArgs(port, userDataPath, applicationArgs = []) {
  if (!Number.isSafeInteger(port) || port <= 0 || port > 65_535) {
    fail(`invalid remote debugging port: ${String(port)}`)
  }
  return [
    ...applicationArgs,
    `--remote-debugging-port=${port}`,
    "--remote-debugging-address=127.0.0.1",
    `--user-data-dir=${userDataPath}`
  ]
}

async function resolveAppWindow(browser, expectedWindowKind) {
  const deadline = Date.now() + APP_BOOT_TIMEOUT_MS
  while (Date.now() < deadline) {
    for (const context of browser.contexts()) {
      for (const page of context.pages()) {
        const kind = await page
          .evaluate(() => document.body?.dataset.window ?? null)
          .catch(() => null)
        if (kind === expectedWindowKind) return page
      }
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100))
  }
  fail(`${expectedWindowKind} window did not become interactive before the deadline`)
}

function attachProcessLogging(child, logPath) {
  child.stdout?.on("data", (chunk) => appendFileSync(logPath, `[app stdout] ${chunk}`))
  child.stderr?.on("data", (chunk) => appendFileSync(logPath, `[app stderr] ${chunk}`))
  return new Promise((resolvePromise) => {
    child.once("close", (code, signal) => resolvePromise({ code, signal }))
  })
}

async function reserveLoopbackPort() {
  const server = createServer()
  await new Promise((resolvePromise, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolvePromise)
  })
  const address = server.address()
  if (!address || typeof address === "string") {
    server.close()
    fail("could not reserve a loopback port for CDP")
  }
  await new Promise((resolvePromise, reject) => {
    server.close((error) => (error ? reject(error) : resolvePromise()))
  })
  return address.port
}

async function waitForDevToolsPort(port, child, getLaunchError) {
  const deadline = Date.now() + APP_BOOT_TIMEOUT_MS
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`)
      if (response.ok) return port
    } catch {
      // The packaged Chromium endpoint is not listening yet.
    }
    if (child.exitCode !== null || child.signalCode !== null) {
      fail(
        `installed executable exited before exposing CDP: code ${String(child.exitCode)} signal ${String(child.signalCode)}`
      )
    }
    const launchError = getLaunchError()
    if (launchError) {
      throw launchError
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100))
  }
  fail("installed executable did not expose CDP before the deadline")
}

async function waitForLoggedProcessClose(processClosed) {
  let timer
  try {
    return await Promise.race([
      processClosed,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("Electron log streams did not close")), 10_000)
      })
    ])
  } finally {
    clearTimeout(timer)
  }
}

function readProcessSessionId(jingleHome) {
  const markerPath = join(jingleHome, "logs", "process-session.json")
  if (!existsSync(markerPath)) {
    return null
  }
  try {
    const marker = JSON.parse(readFileSync(markerPath, "utf8"))
    return typeof marker?.sessionId === "string" ? marker.sessionId : null
  } catch {
    return null
  }
}

export async function readDiagnosticsRuntimeIdentity(
  jingleHome,
  previousSessionId,
  initialLogSize
) {
  const logPath = join(jingleHome, "logs", "jingle.log")
  const deadline = Date.now() + APP_BOOT_TIMEOUT_MS
  while (Date.now() < deadline) {
    const sessionId = readProcessSessionId(jingleHome)
    if (sessionId && sessionId !== previousSessionId && existsSync(logPath)) {
      const log = readFileSync(logPath)
      const currentLog = (
        log.length >= initialLogSize ? log.subarray(initialLogSize) : log
      ).toString("utf8")
      const records = currentLog
        .trim()
        .split("\n")
        .flatMap((line) => {
          try {
            return [JSON.parse(line)]
          } catch {
            return []
          }
        })
      const session = records.findLast(
        (record) =>
          record?.eventCode === "diagnostics.session_started" && record?.sessionId === sessionId
      )
      if (session?.dimensions) {
        return session.dimensions
      }
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100))
  }
  fail("installed executable did not persist its diagnostics runtime identity")
}

function assertCleanProcessSession(jingleHome) {
  const markerPath = join(jingleHome, "logs", "process-session.json")
  if (!existsSync(markerPath)) {
    fail("installed executable did not persist a process session marker")
  }
  const marker = JSON.parse(readFileSync(markerPath, "utf8"))
  if (marker?.terminal?.kind !== "clean_exit") {
    fail(`installed executable did not exit cleanly: ${JSON.stringify(marker?.terminal ?? null)}`)
  }
}

export async function closeApplication(
  browser,
  child,
  jingleHome,
  processClosed,
  shutdownContract,
  operations = {}
) {
  if (
    shutdownContract !== "current-clean-session" &&
    shutdownContract !== "legacy-process-reaped"
  ) {
    fail(`unsupported installed smoke shutdown contract: ${String(shutdownContract)}`)
  }
  const snapshotTree = operations.snapshotProcessTree ?? snapshotProcessTree
  const waitForExit = operations.waitForProcessExit ?? waitForProcessExit
  const waitForLogs = operations.waitForLoggedProcessClose ?? waitForLoggedProcessClose
  const terminateTree = operations.terminateProcessTree ?? terminateProcessTree
  const assertCleanSession = operations.assertCleanProcessSession ?? assertCleanProcessSession
  const processId = child.pid
  if (!processId) {
    fail("installed executable has no process id")
  }
  let inspectionError = null
  let processIds = [processId]
  try {
    processIds = snapshotTree(processId)
  } catch (error) {
    inspectionError = error
  }
  let timer
  try {
    const browserSession = await browser.newBrowserCDPSession()
    await Promise.race([
      browserSession.send("Browser.close"),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("Electron close timed out")), 10_000)
      })
    ])
    await waitForExit(processIds, `Electron process tree rooted at ${processId}`)
    await waitForLogs(processClosed)
    if (shutdownContract === "current-clean-session") {
      assertCleanSession(jingleHome)
    }
    if (inspectionError) throw inspectionError
  } catch (error) {
    const errors = [error]
    if (inspectionError) errors.push(inspectionError)
    if (shutdownContract === "current-clean-session") {
      try {
        assertCleanSession(jingleHome)
        if (child.pid) {
          await terminateTree(child.pid)
          await waitForLogs(processClosed)
        }
        if (!inspectionError) {
          return
        }
      } catch (verificationError) {
        errors.push(verificationError)
      }
    }
    if (child.exitCode !== null || child.signalCode !== null) {
      try {
        await waitForLogs(processClosed)
        if (shutdownContract === "current-clean-session") {
          assertCleanSession(jingleHome)
        }
        if (!inspectionError) {
          return
        }
      } catch (verificationError) {
        errors.push(verificationError)
      }
    }
    if (shutdownContract === "legacy-process-reaped") {
      try {
        await terminateTree(processId)
        await waitForLogs(processClosed)
        if (!inspectionError) {
          return
        }
      } catch (cleanupError) {
        errors.push(cleanupError)
      }
    }
    try {
      await terminateTree(processId)
    } catch (cleanupError) {
      errors.push(cleanupError)
    }
    if (errors.length === 1) throw errors[0]
    throw new AggregateError(errors, "Electron close and cleanup both failed")
  } finally {
    clearTimeout(timer)
    await browser.close().catch(() => undefined)
  }
}

export async function runProbeWithShutdown(runProbe, runShutdown) {
  let probeResult
  let probeError = null
  try {
    probeResult = await runProbe()
  } catch (error) {
    probeError = error
  }

  let shutdownError = null
  try {
    await runShutdown()
  } catch (error) {
    shutdownError = error
  }

  if (probeError && shutdownError) {
    throw new AggregateError(
      [probeError, shutdownError],
      "Installed release probe and shutdown both failed"
    )
  }
  if (probeError) throw probeError
  if (shutdownError) throw shutdownError
  return probeResult
}

async function launchAndProbe(executablePath, jingleHome, logPath, options = {}) {
  if (options.expectedWindowKind !== "main" && options.expectedWindowKind !== "launcher") {
    fail("launch probe requires an exact expected window kind")
  }
  const userDataPath = join(jingleHome, "electron-user-data")
  mkdirSync(userDataPath, { recursive: true })
  const remoteDebuggingPort = await reserveLoopbackPort()
  const previousSessionId = readProcessSessionId(jingleHome)
  const diagnosticsLogPath = join(jingleHome, "logs", "jingle.log")
  const initialLogSize = existsSync(diagnosticsLogPath) ? statSync(diagnosticsLogPath).size : 0
  const launchEnvironment = createLaunchEnvironment(jingleHome, options.environment)
  launchEnvironment.ELECTRON_ENABLE_LOGGING = "1"
  launchEnvironment.ELECTRON_LOG_FILE = join(jingleHome, "electron.log")
  const launchArgs = createRemoteDebuggingLaunchArgs(
    remoteDebuggingPort,
    userDataPath,
    options.launchArgs
  )
  const child = spawn(executablePath, launchArgs, {
    env: launchEnvironment,
    shell: false,
    windowsHide: true
  })
  let launchError = null
  child.once("error", (error) => {
    launchError = error
    appendFileSync(logPath, `[app launch error] ${error.stack ?? error.message}\n`)
  })
  const processClosed = attachProcessLogging(child, logPath)

  let browser = null
  return runProbeWithShutdown(
    async () => {
      const port = await waitForDevToolsPort(remoteDebuggingPort, child, () => launchError)
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, {
        timeout: APP_BOOT_TIMEOUT_MS
      })
      const identity =
        options.requireDiagnosticsIdentity === false
          ? null
          : await readDiagnosticsRuntimeIdentity(jingleHome, previousSessionId, initialLogSize)
      if (identity && identity.isPackaged !== true) {
        fail("installed executable reported isPackaged=false")
      }
      if (identity && options.expectedVersion && identity.appVersion !== options.expectedVersion) {
        fail(
          `installed executable reported version ${identity.appVersion}, expected ${options.expectedVersion}`
        )
      }
      if (identity && identity.platform !== process.platform) {
        fail(
          `installed executable reported platform ${identity.platform}, expected ${process.platform}`
        )
      }
      const page = await resolveAppWindow(browser, options.expectedWindowKind)
      const probe = await page.evaluate(async (sentinelRequest) => {
        const [theme, threads] = await Promise.all([
          window.api.settings.getAppThemeSettings(),
          window.api.threads.list()
        ])
        let sentinelThread = null
        if (sentinelRequest?.mode === "create") {
          const created = await window.api.threads.create({
            metadata: {
              releaseSmokeUpgradeSentinel: {
                schemaVersion: 1,
                sourceVersion: "0.0.1",
                token: sentinelRequest.token
              },
              title: sentinelRequest.title
            },
            workspaceKind: "projectless",
            workspacePath: sentinelRequest.workspacePath
          })
          sentinelThread = {
            metadata: created.metadata ?? null,
            threadId: created.thread_id,
            title: created.title ?? null
          }
        } else if (sentinelRequest?.mode === "verify") {
          const [persisted, refreshedThreads, hydrated] = await Promise.all([
            window.api.threads.get(sentinelRequest.threadId),
            window.api.threads.list(),
            window.api.threads.getAgentThreadData(sentinelRequest.threadId)
          ])
          if (
            !persisted ||
            !refreshedThreads.some((thread) => thread.thread_id === persisted.thread_id) ||
            hydrated.thread.thread_id !== persisted.thread_id
          ) {
            throw new Error(
              "release upgrade sentinel is not visible through the current thread IPC projections"
            )
          }
          sentinelThread = {
            metadata: persisted.metadata ?? null,
            threadId: persisted.thread_id,
            title: persisted.title ?? null
          }
        }
        return {
          platform: window.electron.process.platform,
          rendererReady: (document.getElementById("root")?.childElementCount ?? 0) > 0,
          sentinelThread,
          themeAvailable: typeof theme === "object" && theme !== null,
          threadCount: threads.length,
          windowKind: document.body?.dataset.window ?? null
        }
      }, options.sentinelRequest ?? null)
      if (
        !probe.rendererReady ||
        !probe.themeAvailable ||
        probe.windowKind !== options.expectedWindowKind
      ) {
        fail(`preload IPC probe returned an invalid projection: ${JSON.stringify(probe)}`)
      }
      if (options.sentinelRequest) {
        assertUpgradeSentinelThread(probe.sentinelThread, options.sentinelRequest, "sentinel IPC")
      }
      return {
        electronVersion: identity?.electronVersion ?? null,
        executablePath,
        isPackaged: identity?.isPackaged ?? null,
        protocolClientRegistered: null,
        runtimeIdentityVerified: identity !== null,
        version: identity?.appVersion ?? null,
        ...probe
      }
    },
    async () => {
      if (browser) {
        await closeApplication(
          browser,
          child,
          jingleHome,
          processClosed,
          options.shutdownContract ?? "current-clean-session"
        )
      } else if (child.pid) {
        await terminateProcessTree(child.pid)
        await waitForLoggedProcessClose(processClosed)
      }
    }
  )
}

async function assertProtocolClientRegistration(installed, logPath) {
  if (process.platform === "linux") {
    if (!installed.desktopEntryPath) {
      fail("Linux installation did not return its desktop entry path")
    }
    const execLine = readFileSync(installed.desktopEntryPath, "utf8")
      .split(/\r?\n/)
      .find((line) => line.startsWith("Exec="))
    const expected = `Exec=${installed.executablePath} --no-sandbox %U`
    if (execLine !== expected) {
      fail(`Linux desktop entry has an invalid launch command: ${String(execLine)}`)
    }
    return
  }

  if (process.platform === "win32") {
    const result = await runProcess(
      "reg.exe",
      ["query", "HKCU\\Software\\Classes\\jingle\\shell\\open\\command", "/ve"],
      { cwd: process.cwd(), logPath }
    )
    const commandLine = result.stdout
      .split(/\r?\n/)
      .find((line) => /\sREG_SZ\s/.test(line))
      ?.replace(/^.*?\sREG_SZ\s+/, "")
    if (!commandLine) fail("Windows jingle protocol registration has no default command")
    assertWindowsProtocolCommand(commandLine, installed.executablePath)
    return
  }

  fail(`unsupported protocol registration platform '${process.platform}'`)
}

async function launchInstalledAndProbe(installed, jingleHome, logPath, options) {
  const probe = await launchAndProbe(installed.executablePath, jingleHome, logPath, {
    ...options,
    environment: installed.launchEnvironment,
    launchArgs: installed.launchArgs
  })
  if (options.expectProtocolClient || installed.desktopEntryName) {
    await assertProtocolClientRegistration(installed, logPath)
    probe.protocolClientRegistered = true
  }
  if (installed.desktopEntryName) {
    const environment = { ...process.env, ...installed.launchEnvironment }
    const result = await runProcess("xdg-mime", ["query", "default", "x-scheme-handler/jingle"], {
      cwd: process.cwd(),
      env: environment,
      logPath
    })
    assertLinuxProtocolHandler(result.stdout, installed.desktopEntryName)
    probe.protocolClientRegistered = true
  }
  return probe
}

async function verifyFreshDatabase(jingleHome) {
  const databasePath = join(jingleHome, "jingle.sqlite")
  if (!existsSync(databasePath)) fail("first launch did not create jingle.sqlite")
  const prisma = new PrismaClient({
    datasources: { db: { url: `file:${databasePath}` } }
  })
  try {
    const integrityRows = await prisma.$queryRawUnsafe("PRAGMA integrity_check")
    if (integrityRows.length !== 1 || Object.values(integrityRows[0])[0] !== "ok") {
      fail(`fresh database integrity check failed: ${JSON.stringify(integrityRows)}`)
    }
    const migrationRows = await prisma.$queryRawUnsafe(
      "SELECT migration_name, checksum, finished_at, rolled_back_at FROM _prisma_migrations ORDER BY migration_name"
    )
    const appliedMigrations = migrationRows.map((row) => ({
      checksum: row.checksum,
      name: row.migration_name
    }))
    if (JSON.stringify(appliedMigrations) !== JSON.stringify(requiredMigrations)) {
      fail("fresh database migration ledger does not match the packaged source manifest")
    }
    if (migrationRows.some((row) => !row.finished_at || row.rolled_back_at)) {
      fail("fresh database contains an incomplete or rolled-back migration")
    }
    const tableRows = await prisma.$queryRawUnsafe(
      "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('threads','messages','runs','checkpoints','thread_workflows')"
    )
    const tableNames = new Set(tableRows.map((row) => row.name))
    for (const tableName of ["threads", "messages", "runs", "checkpoints", "thread_workflows"]) {
      if (!tableNames.has(tableName)) fail(`fresh database is missing table '${tableName}'`)
    }
  } finally {
    await prisma.$disconnect()
  }
}

async function verifyUpgradeDatabase(jingleHome, sentinel) {
  const databasePath = join(jingleHome, "jingle.sqlite")
  const prisma = new PrismaClient({
    datasources: { db: { url: `file:${databasePath.replaceAll("\\", "/")}` } }
  })
  try {
    const integrityRows = await prisma.$queryRawUnsafe("PRAGMA integrity_check")
    if (integrityRows.length !== 1 || Object.values(integrityRows[0])[0] !== "ok") {
      fail(`upgrade database integrity check failed: ${JSON.stringify(integrityRows)}`)
    }
    const migrationRows = await prisma.$queryRawUnsafe(
      "SELECT migration_name, checksum, finished_at, rolled_back_at FROM _prisma_migrations ORDER BY migration_name"
    )
    const appliedMigrations = migrationRows.map((row) => ({
      checksum: row.checksum,
      name: row.migration_name
    }))
    if (JSON.stringify(appliedMigrations) !== JSON.stringify(requiredMigrations)) {
      fail("upgrade database migration ledger does not match the packaged source manifest")
    }
    if (migrationRows.some((row) => !row.finished_at || row.rolled_back_at)) {
      fail("upgrade database contains an incomplete or rolled-back migration")
    }
    const threadRows = await prisma.$queryRawUnsafe(
      "SELECT thread_id, title, metadata FROM threads WHERE thread_id = ?",
      sentinel.threadId
    )
    if (threadRows.length !== 1) fail("upgrade sentinel is missing from the database")
    const row = threadRows[0]
    const metadata = typeof row.metadata === "string" ? JSON.parse(row.metadata) : null
    assertUpgradeSentinelThread(
      { metadata, threadId: row.thread_id, title: row.title },
      sentinel,
      "upgrade database"
    )
    const bindingRows = await prisma.$queryRawUnsafe(
      "SELECT workspace_kind, workspace_path, project_id, workspace_key FROM thread_workspace_bindings WHERE thread_id = ?",
      sentinel.threadId
    )
    if (
      bindingRows.length !== 1 ||
      bindingRows[0].workspace_kind !== "projectless" ||
      bindingRows[0].workspace_path !== sentinel.workspacePath ||
      bindingRows[0].project_id !== null ||
      bindingRows[0].workspace_key !== null
    ) {
      fail("upgrade sentinel workspace binding differs from the old artifact IPC request")
    }
  } finally {
    await prisma.$disconnect()
  }
}

function preserveDiagnostics(sourceHome, diagnosticsRoot, manifest) {
  mkdirSync(diagnosticsRoot, { recursive: true })
  const logsPath = join(sourceHome, "logs")
  if (existsSync(logsPath)) {
    cpSync(logsPath, join(diagnosticsRoot, "logs"), { recursive: true })
  }
  for (const fileName of ["jingle.sqlite", "jingle.sqlite-wal", "jingle.sqlite-shm"]) {
    const sourcePath = join(sourceHome, fileName)
    if (existsSync(sourcePath)) copyFileSync(sourcePath, join(diagnosticsRoot, fileName))
  }
  const electronLogPath = join(sourceHome, "electron.log")
  if (existsSync(electronLogPath)) {
    copyFileSync(electronLogPath, join(diagnosticsRoot, "electron.log"))
  }
  writeFileSync(join(diagnosticsRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`)
}

function describeError(error) {
  const message = error instanceof Error ? error.message : String(error)
  if (error instanceof AggregateError) {
    return [message, ...error.errors.flatMap((nestedError) => describeError(nestedError))]
  }
  return [message]
}

async function run() {
  const upgradeReleaseRepository = process.env.GITHUB_REPOSITORY
  const upgradeReleaseToken = process.env.GITHUB_TOKEN
  delete process.env.GITHUB_TOKEN
  delete process.env.GH_TOKEN
  const currentDir = resolve(readArgument("--current-dir", "dist"))
  const diagnosticsRoot = resolve(readArgument("--diagnostics-dir", "release-smoke-diagnostics"))
  const requestedBaselineTag = readArgument("--upgrade-baseline", "v0.0.1")
  const artifactPath = selectInstallerArtifact(currentDir)
  const workspace = mkdtempSync(join(tmpdir(), "jingle-installed-release-smoke-"))
  const freshInstallRoot = join(workspace, "fresh-installed")
  const freshHome = join(workspace, "fresh-home")
  const upgradeWorkspace = join(workspace, "upgrade")
  const upgradeInstallRoot = join(upgradeWorkspace, "installed")
  const upgradeHome = join(upgradeWorkspace, "jingle-home")
  const commandLog = join(workspace, "commands.log")
  const appLog = join(workspace, "application.log")
  const upgradeMode = createUpgradeInstallMode(process.platform)
  const manifest = {
    arch: process.arch,
    artifact: basename(artifactPath),
    phase: "fresh-install",
    platform: process.platform,
    runnerArch: process.env.JINGLE_RELEASE_RUNNER_ARCH ?? null,
    runnerOs: process.env.JINGLE_RELEASE_RUNNER_OS ?? null,
    upgradeMode
  }
  let diagnosticHome = freshHome
  let freshWindowsPayloadInventory = null
  rmSync(diagnosticsRoot, { force: true, recursive: true })
  mkdirSync(upgradeWorkspace, { recursive: true })
  writeFileSync(commandLog, "")
  writeFileSync(appLog, "")

  let primaryError = null
  try {
    const freshProbe = await withInstalledArtifact(
      {
        artifactPath,
        installRoot: freshInstallRoot,
        logPath: commandLog,
        workspace
      },
      async (installed) => {
        manifest.phase = "fresh-packaged-runtime-audit"
        await runProcess(
          process.execPath,
          [resolve("scripts/audit-packaged-runtime.mjs"), installed.appRoot],
          { cwd: process.cwd(), logPath: commandLog }
        )
        manifest.phase = "fresh-first-launch"
        const probe = await launchInstalledAndProbe(installed, freshHome, appLog, {
          expectProtocolClient: process.platform === "win32",
          expectedVersion: currentPackageVersion,
          expectedWindowKind: "main"
        })
        manifest.phase = "fresh-database-verification"
        await verifyFreshDatabase(freshHome)
        if (upgradeMode === "nsis-in-place") {
          freshWindowsPayloadInventory = createWindowsPayloadInventory(installed.appRoot)
        }
        return probe
      }
    )

    diagnosticHome = upgradeHome
    manifest.phase = "upgrade-baseline"
    const baseline = readUpgradeBaseline()
    if (requestedBaselineTag !== baseline.tag) {
      fail(`upgrade baseline ${requestedBaselineTag} is not the reviewed ${baseline.tag}`)
    }
    await prepareUpgradeBaseline({
      dependencyRoot: process.cwd(),
      jingleHome: upgradeHome,
      repositoryRoot: process.cwd(),
      workspace: upgradeWorkspace
    })
    const previousArtifactRoot = join(upgradeWorkspace, "previous-artifact")
    mkdirSync(previousArtifactRoot)
    manifest.phase = "upgrade-previous-artifact-download"
    const previousArtifact = await downloadUpgradeAsset({
      arch: process.arch,
      baseline,
      outputRoot: previousArtifactRoot,
      platform: process.platform,
      repository: upgradeReleaseRepository,
      token: upgradeReleaseToken
    })
    manifest.previousArtifact = previousArtifact.asset.name
    manifest.previousArtifactSha256 = previousArtifact.asset.sha256
    manifest.previousTag = baseline.tag

    const sentinel = {
      threadId: null,
      title: "Jingle v0.0.1 upgrade sentinel",
      token: randomUUID(),
      workspacePath: join(upgradeWorkspace, "sentinel-workspace")
    }
    mkdirSync(sentinel.workspacePath)
    const runPrevious = async (installed) => {
      manifest.phase = "upgrade-previous-ipc-sentinel"
      const probe = await launchInstalledAndProbe(installed, upgradeHome, appLog, {
        expectedVersion: "0.0.1",
        expectedWindowKind: baseline.windowKind,
        shutdownContract: "legacy-process-reaped",
        requireDiagnosticsIdentity: false,
        sentinelRequest: {
          mode: "create",
          title: sentinel.title,
          token: sentinel.token,
          workspacePath: sentinel.workspacePath
        }
      })
      if (!probe.sentinelThread?.threadId) fail("old artifact did not return a sentinel thread id")
      return probe
    }
    const runCurrent = async (installed, previousProbe) => {
      sentinel.threadId = previousProbe.sentinelThread.threadId
      if (upgradeMode === "nsis-in-place") {
        if (!freshWindowsPayloadInventory) {
          fail("fresh Windows installation payload inventory is unavailable")
        }
        assertWindowsPayloadMatchesFreshInstall(
          freshWindowsPayloadInventory,
          createWindowsPayloadInventory(installed.appRoot)
        )
      }
      manifest.phase = "upgrade-current-packaged-runtime-audit"
      await runProcess(
        process.execPath,
        [resolve("scripts/audit-packaged-runtime.mjs"), installed.appRoot],
        { cwd: process.cwd(), logPath: commandLog }
      )
      manifest.phase = "upgrade-current-ipc-verification"
      const probe = await launchInstalledAndProbe(installed, upgradeHome, appLog, {
        expectProtocolClient: process.platform === "win32",
        expectedVersion: currentPackageVersion,
        expectedWindowKind: "main",
        sentinelRequest: {
          mode: "verify",
          threadId: sentinel.threadId,
          title: sentinel.title,
          token: sentinel.token
        }
      })
      if (upgradeMode === "nsis-in-place") {
        manifest.phase = "upgrade-current-database-verification"
        await verifyUpgradeDatabase(upgradeHome, sentinel)
      }
      return probe
    }

    manifest.phase = "upgrade-previous-install"
    appendFileSync(appLog, `[upgrade previous ${baseline.tag}]\n`)
    let previousProbe
    let currentProbe
    if (upgradeMode === "nsis-in-place") {
      const result = await withWindowsInPlaceUpgrade({
        beforeCurrent: async () => {
          manifest.phase = "upgrade-current-install"
          appendFileSync(appLog, `[upgrade current ${currentPackageVersion}]\n`)
        },
        currentArtifactPath: artifactPath,
        installRoot: upgradeInstallRoot,
        logPath: commandLog,
        previousArtifactPath: previousArtifact.path,
        runCurrent,
        runPrevious,
        workspace: upgradeWorkspace
      })
      previousProbe = result.previousResult
      currentProbe = result.currentResult
    } else {
      previousProbe = await withInstalledArtifact(
        {
          artifactPath: previousArtifact.path,
          installRoot: upgradeInstallRoot,
          logPath: commandLog,
          requireProtocolEntry: false,
          workspace: upgradeWorkspace
        },
        runPrevious
      )
      sentinel.threadId = previousProbe.sentinelThread.threadId
      manifest.phase = "upgrade-current-install"
      appendFileSync(appLog, `[upgrade current ${currentPackageVersion}]\n`)
      currentProbe = await withInstalledArtifact(
        {
          artifactPath,
          installRoot: upgradeInstallRoot,
          logPath: commandLog,
          workspace: upgradeWorkspace
        },
        (installed) => runCurrent(installed, previousProbe)
      )
    }
    if (upgradeMode !== "nsis-in-place") {
      manifest.phase = "upgrade-current-database-verification"
      await verifyUpgradeDatabase(upgradeHome, sentinel)
    }
    manifest.phase = "complete"
    console.log(
      `installed release smoke passed: ${JSON.stringify({ currentProbe, freshProbe, previousProbe, upgradeMode })}`
    )
  } catch (error) {
    primaryError = error
  }

  if (primaryError) {
    manifest.phase = `failed:${manifest.phase}`
    const errors = [primaryError]
    manifest.errors = errors.flatMap((error) => describeError(error))
    try {
      preserveDiagnostics(diagnosticHome, diagnosticsRoot, manifest)
      copyFileSync(commandLog, join(diagnosticsRoot, "commands.log"))
      copyFileSync(appLog, join(diagnosticsRoot, "application.log"))
    } catch (error) {
      errors.push(error)
    }
    try {
      rmSync(workspace, { force: true, recursive: true })
    } catch (error) {
      errors.push(error)
    }
    if (errors.length === 1) throw primaryError
    throw new AggregateError(errors, "Installed release smoke failed with cleanup errors")
  }

  rmSync(diagnosticsRoot, { force: true, recursive: true })
  rmSync(workspace, { force: true, recursive: true })
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await run()
}
