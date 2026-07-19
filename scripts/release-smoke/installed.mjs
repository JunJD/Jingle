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
import { basename, join, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { PrismaClient } from "@prisma/client"
import { _electron as electron } from "playwright"
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
const requiredMigrations = readdirSync(resolve("prisma/migrations"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => ({
    checksum: createHash("sha256")
      .update(readFileSync(resolve("prisma/migrations", entry.name, "migration.sql")))
      .digest("hex"),
    name: entry.name
  }))
  .sort((left, right) => left.name.localeCompare(right.name))

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
    }

    function finish(error) {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error) reject(error)
      else resolvePromise()
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
  return {
    appRoot: invocation.installRoot,
    executablePath: findSingle(
      invocation.installRoot,
      (path) => basename(path).toLowerCase() === "jingle.exe",
      "installed Jingle.exe"
    )
  }
}

async function installLinux(invocation, workspace, logPath) {
  const appImagePath = join(invocation.installRoot, "Jingle.AppImage")
  const extractRoot = join(invocation.installRoot, "extracted")
  mkdirSync(invocation.installRoot, { recursive: true })
  mkdirSync(extractRoot, { recursive: true })
  copyFileSync(invocation.artifactPath, appImagePath)
  chmodSync(appImagePath, 0o755)
  await runProcess(appImagePath, ["--appimage-extract"], { cwd: extractRoot, logPath })
  const appRoot = join(extractRoot, "squashfs-root")
  const executablePath = join(appRoot, "AppRun")
  if (!existsSync(executablePath)) fail(`AppImage extraction missed ${executablePath}`)
  return { appRoot, executablePath }
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

function createLaunchEnvironment(jingleHome) {
  const env = {
    ...process.env,
    CI: "1",
    JINGLE_HOME: jingleHome,
    JINGLE_REMOTE_DEBUGGING_PORT: ""
  }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.ELECTRON_RENDERER_URL
  delete env.JINGLE_BDD
  delete env.JINGLE_BDD_AGENT_RUNTIME
  delete env.JINGLE_BDD_EXTENSION_RUNTIME_FIXTURES
  return env
}

async function resolveAppWindow(application, expectedWindowKind) {
  const deadline = Date.now() + APP_BOOT_TIMEOUT_MS
  while (Date.now() < deadline) {
    for (const page of application.windows()) {
      const kind = await page
        .evaluate(() => document.body?.dataset.window ?? null)
        .catch(() => null)
      if (kind === expectedWindowKind) return page
    }
    await application.waitForEvent("window", { timeout: 250 }).catch(() => null)
  }
  fail(`${expectedWindowKind} window did not become interactive before the deadline`)
}

async function closeApplication(application) {
  const processId = application.process().pid
  let inspectionError = null
  let processIds = [processId]
  try {
    processIds = snapshotProcessTree(processId)
  } catch (error) {
    inspectionError = error
  }
  let timer
  try {
    await Promise.race([
      application.close(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("Electron close timed out")), 10_000)
      })
    ])
  } catch (error) {
    const errors = [error]
    if (inspectionError) errors.push(inspectionError)
    try {
      await terminateProcessTree(processId)
    } catch (cleanupError) {
      errors.push(cleanupError)
    }
    if (errors.length === 1) throw errors[0]
    throw new AggregateError(errors, "Electron close and cleanup both failed")
  } finally {
    clearTimeout(timer)
  }
  await waitForProcessExit(processIds, `Electron process tree rooted at ${processId}`)
  if (inspectionError) throw inspectionError
}

async function launchAndProbe(executablePath, jingleHome, logPath, options = {}) {
  if (options.expectedWindowKind !== "main" && options.expectedWindowKind !== "launcher") {
    fail("launch probe requires an exact expected window kind")
  }
  const userDataPath = join(jingleHome, "electron-user-data")
  const application = await electron.launch({
    args: [`--user-data-dir=${userDataPath}`],
    chromiumSandbox: true,
    env: createLaunchEnvironment(jingleHome),
    executablePath,
    timeout: APP_BOOT_TIMEOUT_MS
  })
  application
    .process()
    .stdout?.on("data", (chunk) => appendFileSync(logPath, `[app stdout] ${chunk}`))
  application
    .process()
    .stderr?.on("data", (chunk) => appendFileSync(logPath, `[app stderr] ${chunk}`))

  try {
    const identity = await application.evaluate(({ app }) => ({
      executablePath: process.execPath,
      isPackaged: app.isPackaged,
      version: app.getVersion()
    }))
    if (!identity.isPackaged) fail("installed executable reported app.isPackaged=false")
    if (options.expectedVersion && identity.version !== options.expectedVersion) {
      fail(
        `installed executable reported version ${identity.version}, expected ${options.expectedVersion}`
      )
    }
    const page = await resolveAppWindow(application, options.expectedWindowKind)
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
    return { ...identity, ...probe }
  } finally {
    await closeApplication(application)
  }
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
  const manifest = {
    arch: process.arch,
    artifact: basename(artifactPath),
    phase: "fresh-install",
    platform: process.platform
  }
  let diagnosticHome = freshHome
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
        const probe = await launchAndProbe(installed.executablePath, freshHome, appLog, {
          expectedVersion: currentPackageVersion,
          expectedWindowKind: "main"
        })
        manifest.phase = "fresh-database-verification"
        await verifyFreshDatabase(freshHome)
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
    manifest.phase = "upgrade-previous-install"
    appendFileSync(appLog, `[upgrade previous ${baseline.tag}]\n`)
    const previousProbe = await withInstalledArtifact(
      {
        artifactPath: previousArtifact.path,
        installRoot: upgradeInstallRoot,
        logPath: commandLog,
        workspace: upgradeWorkspace
      },
      async (installed) => {
        manifest.phase = "upgrade-previous-ipc-sentinel"
        return launchAndProbe(installed.executablePath, upgradeHome, appLog, {
          expectedVersion: "0.0.1",
          expectedWindowKind: baseline.windowKind,
          sentinelRequest: {
            mode: "create",
            title: sentinel.title,
            token: sentinel.token,
            workspacePath: sentinel.workspacePath
          }
        })
      }
    )
    sentinel.threadId = previousProbe.sentinelThread?.threadId ?? null
    if (!sentinel.threadId) fail("old artifact did not return a sentinel thread id")

    manifest.phase = "upgrade-current-install"
    appendFileSync(appLog, `[upgrade current ${currentPackageVersion}]\n`)
    const currentProbe = await withInstalledArtifact(
      {
        artifactPath,
        installRoot: upgradeInstallRoot,
        logPath: commandLog,
        workspace: upgradeWorkspace
      },
      async (installed) => {
        manifest.phase = "upgrade-current-packaged-runtime-audit"
        await runProcess(
          process.execPath,
          [resolve("scripts/audit-packaged-runtime.mjs"), installed.appRoot],
          { cwd: process.cwd(), logPath: commandLog }
        )
        manifest.phase = "upgrade-current-ipc-verification"
        return launchAndProbe(installed.executablePath, upgradeHome, appLog, {
          expectedVersion: currentPackageVersion,
          expectedWindowKind: "main",
          sentinelRequest: {
            mode: "verify",
            threadId: sentinel.threadId,
            title: sentinel.title,
            token: sentinel.token
          }
        })
      }
    )
    manifest.phase = "upgrade-current-database-verification"
    await verifyUpgradeDatabase(upgradeHome, sentinel)
    manifest.phase = "complete"
    console.log(
      `installed release smoke passed: ${JSON.stringify({ currentProbe, freshProbe, previousProbe })}`
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
