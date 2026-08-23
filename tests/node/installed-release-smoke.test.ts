import assert from "node:assert/strict"
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import test from "node:test"

interface InstalledSmokeModule {
  closeApplication(
    browser: {
      close(): Promise<void>
      newBrowserCDPSession(): Promise<{ send(command: string): Promise<void> }>
    },
    child: { exitCode: number | null; pid: number; signalCode: string | null },
    jingleHome: string,
    processClosed: Promise<void>,
    shutdownContract: "current-clean-session" | "legacy-process-reaped",
    operations: {
      assertCleanProcessSession(): void
      snapshotProcessTree(pid: number): number[]
      terminateProcessTree(pid: number): Promise<void>
      waitForLoggedProcessClose(closed: Promise<void>): Promise<void>
      waitForProcessExit(pids: number[], description: string): Promise<void>
    }
  ): Promise<void>
  assertLinuxDesktopEntryLaunch(source: string): string
  assertLinuxProtocolHandler(output: string, desktopEntryName: string): string
  assertMacProtocolDeclaration(value: unknown): string[]
  assertWindowsProtocolCommand(
    command: string,
    executablePath: string
  ): { argumentTemplate: string; executablePath: string }
  assertWindowsPayloadMatchesFreshInstall(expected: unknown, actual: unknown): unknown
  assertUpgradeSentinelThread(
    thread: unknown,
    sentinel: { threadId?: string | null; title: string; token: string },
    owner: string
  ): unknown
  createInstallerInvocation(
    platform: string,
    artifactPath: string,
    installRoot: string
  ): Record<string, unknown>
  createLinuxXdgEnvironment(root: string): Record<string, string>
  createUpgradeInstallMode(platform: string): "data-only-reinstall" | "nsis-in-place"
  createWindowsPayloadInventory(root: string): {
    payload: Array<{ path: string; sha256: string; size: number }>
    uninstaller: { path: string; sha256: string; size: number }
  }
  ensureLinuxAppImageExecutable(artifactPath: string): void
  readDiagnosticsRuntimeIdentity(
    jingleHome: string,
    previousSessionId: string | null,
    initialLogSize: number
  ): Promise<Record<string, unknown>>
  runProbeWithShutdown<T>(runProbe: () => Promise<T>, runShutdown: () => Promise<void>): Promise<T>
  runProcess(
    command: string,
    args: string[],
    options: { cwd: string; logPath: string; timeoutMs: number }
  ): Promise<{ stderr: string; stdout: string }>
  withWindowsInPlaceUpgrade(
    input: {
      beforeCurrent(): Promise<void>
      currentArtifactPath: string
      installRoot: string
      logPath: string
      previousArtifactPath: string
      runCurrent(installed: Record<string, unknown>, previousResult: unknown): Promise<unknown>
      runPrevious(installed: Record<string, unknown>): Promise<unknown>
      workspace: string
    },
    operations: {
      cleanup(input: Record<string, unknown>): Promise<void>
      createInvocation(platform: string, artifactPath: string, installRoot: string): unknown
      install(
        invocation: unknown,
        workspace: string,
        logPath: string
      ): Promise<Record<string, unknown>>
    }
  ): Promise<{ currentResult: unknown; previousResult: unknown }>
  selectInstallerArtifact(root: string, platform: string): string
  selectLinuxDesktopEntry(appRoot: string): string
  selectMountedMacApp(mountPath: string): string
}

const moduleUrl = pathToFileURL(join(process.cwd(), "scripts/release-smoke/installed.mjs")).href
const smokeModulePromise = import(moduleUrl) as Promise<InstalledSmokeModule>

test("uses capability-specific shutdown evidence for current and legacy packages", async () => {
  const smokeModule = await smokeModulePromise
  const calls: string[] = []
  const browser = {
    close: async () => {
      calls.push("disconnect")
    },
    newBrowserCDPSession: async () => ({
      send: async () => {
        throw new Error("legacy target already closed")
      }
    })
  }
  const child = { exitCode: null, pid: 42, signalCode: null }
  const operations = {
    assertCleanProcessSession: () => {
      calls.push("clean-session")
      throw new Error("missing current clean-session evidence")
    },
    snapshotProcessTree: () => [42],
    terminateProcessTree: async () => {
      calls.push("terminate")
    },
    waitForLoggedProcessClose: async () => {
      calls.push("logs-closed")
    },
    waitForProcessExit: async () => {
      calls.push("process-exit")
    }
  }

  await smokeModule.closeApplication(
    browser,
    child,
    "/tmp/legacy-jingle-home",
    Promise.resolve(),
    "legacy-process-reaped",
    operations
  )
  assert.deepEqual(calls, ["terminate", "logs-closed", "disconnect"])

  calls.length = 0
  await assert.rejects(
    smokeModule.closeApplication(
      browser,
      child,
      "/tmp/current-jingle-home",
      Promise.resolve(),
      "current-clean-session",
      operations
    ),
    /Electron close and cleanup both failed/
  )
  assert.deepEqual(calls, ["clean-session", "terminate", "disconnect"])
})

test("preserves probe failures while applying capability-specific shutdown", async () => {
  const smokeModule = await smokeModulePromise
  const probeError = new Error("sentinel IPC failed")

  await assert.rejects(
    smokeModule.runProbeWithShutdown(
      async () => {
        throw probeError
      },
      async () => undefined
    ),
    (error) => error === probeError
  )

  const shutdownError = new Error("clean-session evidence missing")
  await assert.rejects(
    smokeModule.runProbeWithShutdown(
      async () => {
        throw probeError
      },
      async () => {
        throw shutdownError
      }
    ),
    (error) => {
      assert.ok(error instanceof AggregateError)
      assert.deepEqual(error.errors, [probeError, shutdownError])
      return true
    }
  )
})

test("selects exactly one native installer and excludes update metadata", async () => {
  const smokeModule = await smokeModulePromise
  const root = mkdtempSync(join(tmpdir(), "jingle-installed-smoke-artifacts-"))
  mkdirSync(join(root, "nested"))
  writeFileSync(join(root, "Jingle-1.0.0-win-x64.exe"), "installer")
  writeFileSync(join(root, "nested", "Jingle.exe"), "unpacked application")
  writeFileSync(join(root, "nested", "Jingle-1.0.0-win-x64.exe.blockmap"), "metadata")
  assert.equal(
    smokeModule.selectInstallerArtifact(root, "win32"),
    join(root, "Jingle-1.0.0-win-x64.exe")
  )
})

test("rejects ambiguous and missing native installer sets", async () => {
  const smokeModule = await smokeModulePromise
  const root = mkdtempSync(join(tmpdir(), "jingle-installed-smoke-ambiguous-"))
  assert.throws(() => smokeModule.selectInstallerArtifact(root, "darwin"), /found 0/)
  writeFileSync(join(root, "first.dmg"), "one")
  writeFileSync(join(root, "second.dmg"), "two")
  assert.throws(() => smokeModule.selectInstallerArtifact(root, "darwin"), /found 2/)
})

test("selects only the top-level macOS app and ignores Electron helper apps", async () => {
  const smokeModule = await smokeModulePromise
  const root = mkdtempSync(join(tmpdir(), "jingle-installed-smoke-dmg-"))
  const appRoot = join(root, "Jingle.app")
  const helperRoot = join(appRoot, "Contents", "Frameworks", "Jingle Helper.app")
  mkdirSync(join(appRoot, "Contents"), { recursive: true })
  mkdirSync(join(helperRoot, "Contents"), { recursive: true })
  writeFileSync(join(appRoot, "Contents", "Info.plist"), "app")
  writeFileSync(join(helperRoot, "Contents", "Info.plist"), "helper")

  assert.equal(smokeModule.selectMountedMacApp(root), appRoot)
  mkdirSync(join(root, "Another.app", "Contents"), { recursive: true })
  writeFileSync(join(root, "Another.app", "Contents", "Info.plist"), "second")
  assert.throws(() => smokeModule.selectMountedMacApp(root), /top-level app.*found 2/)
})

test("requires the packaged macOS jingle URL declaration", async () => {
  const smokeModule = await smokeModulePromise
  assert.deepEqual(
    smokeModule.assertMacProtocolDeclaration([
      { CFBundleURLName: "Jingle OAuth Callback", CFBundleURLSchemes: ["jingle"] }
    ]),
    ["jingle"]
  )
  assert.throws(
    () => smokeModule.assertMacProtocolDeclaration([{ CFBundleURLSchemes: ["https"] }]),
    /does not declare the jingle URL scheme/
  )
})

test("builds fail-closed platform install plans", async () => {
  const smokeModule = await smokeModulePromise
  assert.deepEqual(smokeModule.createInstallerInvocation("darwin", "/tmp/a.dmg", "/tmp/app"), {
    artifactPath: "/tmp/a.dmg",
    installRoot: "/tmp/app",
    kind: "dmg"
  })
  assert.deepEqual(smokeModule.createInstallerInvocation("linux", "/tmp/a.AppImage", "/tmp/app"), {
    artifactPath: "/tmp/a.AppImage",
    installRoot: "/tmp/app",
    kind: "appimage"
  })
  assert.deepEqual(
    smokeModule.createInstallerInvocation("win32", "C:\\artifact.exe", "C:\\install root"),
    {
      args: ["/S", "/D=C:\\install root"],
      command: "C:\\artifact.exe",
      installRoot: "C:\\install root",
      kind: "nsis",
      windowsVerbatimArguments: true
    }
  )
  assert.throws(
    () => smokeModule.createInstallerInvocation("win32", "C:\\a.exe", "C:\\bad\npath"),
    /invalid character/
  )
  assert.throws(
    () => smokeModule.createInstallerInvocation("win32", "C:\\bad\nartifact.exe", "C:\\app"),
    /invalid character/
  )
  assert.throws(() => smokeModule.createInstallerInvocation("freebsd", "a", "b"), /unsupported/)
  assert.equal(smokeModule.createUpgradeInstallMode("win32"), "nsis-in-place")
  assert.equal(smokeModule.createUpgradeInstallMode("darwin"), "data-only-reinstall")
  assert.equal(smokeModule.createUpgradeInstallMode("linux"), "data-only-reinstall")
  assert.throws(() => smokeModule.createUpgradeInstallMode("freebsd"), /unsupported/)
})

test("isolates Linux desktop state and selects the packaged jingle protocol entry", async () => {
  const smokeModule = await smokeModulePromise
  const root = mkdtempSync(join(tmpdir(), "jingle-installed-smoke-linux-xdg-"))
  const appRoot = join(root, "app")
  mkdirSync(appRoot)
  writeFileSync(
    join(appRoot, "jingle.desktop"),
    "[Desktop Entry]\nName=Jingle\nMimeType=x-scheme-handler/jingle;\n"
  )
  writeFileSync(
    join(appRoot, "other.desktop"),
    "[Desktop Entry]\nName=Other\nMimeType=text/plain;\n"
  )

  const environment = smokeModule.createLinuxXdgEnvironment(join(root, "xdg"))
  assert.equal(environment.HOME, join(root, "xdg", "home"))
  for (const [name, path] of Object.entries(environment)) {
    assert.ok(path.startsWith(join(root, "xdg")), `${name} escaped the isolated XDG root`)
  }
  assert.equal(smokeModule.selectLinuxDesktopEntry(appRoot), join(appRoot, "jingle.desktop"))
  assert.equal(
    smokeModule.assertLinuxDesktopEntryLaunch(
      "[Desktop Entry]\nExec=AppRun --no-sandbox %U\nMimeType=x-scheme-handler/jingle;\n"
    ),
    "Exec=AppRun --no-sandbox %U"
  )
  assert.throws(
    () =>
      smokeModule.assertLinuxDesktopEntryLaunch(
        "[Desktop Entry]\nExec=AppRun %U\nMimeType=x-scheme-handler/jingle;\n"
      ),
    /invalid launch command/
  )
  assert.equal(
    smokeModule.assertLinuxProtocolHandler("jingle.desktop\n", "jingle.desktop"),
    "jingle.desktop"
  )
  assert.throws(
    () => smokeModule.assertLinuxProtocolHandler("other.desktop\n", "jingle.desktop"),
    /expected x-scheme-handler\/jingle/
  )
})

test("makes the downloaded Linux baseline AppImage executable in place", async () => {
  const smokeModule = await smokeModulePromise
  const root = mkdtempSync(join(tmpdir(), "jingle-installed-smoke-linux-appimage-"))
  const artifactPath = join(root, "baseline.AppImage")
  writeFileSync(artifactPath, "appimage")
  chmodSync(artifactPath, 0o640)

  smokeModule.ensureLinuxAppImageExecutable(artifactPath)

  assert.equal(statSync(artifactPath).mode & 0o777, 0o751)
  assert.equal(readFileSync(artifactPath, "utf8"), "appimage")
})

test("rejects stale or ambiguous payload after a Windows in-place upgrade", async () => {
  const smokeModule = await smokeModulePromise
  const root = mkdtempSync(join(tmpdir(), "jingle-installed-smoke-windows-payload-"))
  const freshRoot = join(root, "fresh")
  const upgradedRoot = join(root, "upgraded")
  try {
    for (const installRoot of [freshRoot, upgradedRoot]) {
      mkdirSync(join(installRoot, "resources"), { recursive: true })
      writeFileSync(join(installRoot, "Jingle.exe"), "current executable")
      writeFileSync(join(installRoot, "resources", "app.asar"), "current asar")
      writeFileSync(join(installRoot, "Uninstall Jingle.exe"), "current uninstaller")
    }
    const fresh = smokeModule.createWindowsPayloadInventory(freshRoot)
    const upgraded = smokeModule.createWindowsPayloadInventory(upgradedRoot)
    assert.deepEqual(
      fresh.payload.map((entry) => entry.path),
      ["Jingle.exe", "resources/app.asar"]
    )
    assert.equal(fresh.uninstaller.path, "Uninstall Jingle.exe")
    assert.equal(smokeModule.assertWindowsPayloadMatchesFreshInstall(fresh, upgraded), upgraded)

    writeFileSync(join(upgradedRoot, "old-version-only.dll"), "stale payload")
    assert.throws(
      () =>
        smokeModule.assertWindowsPayloadMatchesFreshInstall(
          fresh,
          smokeModule.createWindowsPayloadInventory(upgradedRoot)
        ),
      /differs from a fresh current installation/
    )
    rmSync(join(upgradedRoot, "old-version-only.dll"))
    writeFileSync(join(upgradedRoot, "resources", "app.asar"), "old asar")
    assert.throws(
      () =>
        smokeModule.assertWindowsPayloadMatchesFreshInstall(
          fresh,
          smokeModule.createWindowsPayloadInventory(upgradedRoot)
        ),
      /differs from a fresh current installation/
    )
    writeFileSync(join(upgradedRoot, "resources", "app.asar"), "current asar")
    writeFileSync(join(upgradedRoot, "Uninstall Jingle.exe"), "old uninstaller")
    assert.throws(
      () =>
        smokeModule.assertWindowsPayloadMatchesFreshInstall(
          fresh,
          smokeModule.createWindowsPayloadInventory(upgradedRoot)
        ),
      /differs from a fresh current installation/
    )
    writeFileSync(join(upgradedRoot, "Uninstall old Jingle.exe"), "stale uninstaller")
    assert.throws(
      () => smokeModule.createWindowsPayloadInventory(upgradedRoot),
      /exactly one Windows uninstaller/
    )
  } finally {
    rmSync(root, { force: true, recursive: true })
  }
})

test("parses the exact Windows protocol command owner", async () => {
  const smokeModule = await smokeModulePromise
  const executablePath = "C:\\Users\\runner\\Jingle\\Jingle.exe"

  assert.deepEqual(
    smokeModule.assertWindowsProtocolCommand(`"${executablePath}" "%1"`, executablePath),
    {
      argumentTemplate: '"%1"',
      executablePath
    }
  )
  assert.throws(
    () => smokeModule.assertWindowsProtocolCommand(`"${executablePath}.old" "%1"`, executablePath),
    /does not target the installed executable/
  )
  assert.throws(
    () =>
      smokeModule.assertWindowsProtocolCommand(`"${executablePath}" --extra "%1"`, executablePath),
    /invalid URL argument template/
  )
})

test("binds diagnostics identity to the newly started process session", async () => {
  const smokeModule = await smokeModulePromise
  const jingleHome = mkdtempSync(join(tmpdir(), "jingle-release-session-identity-"))
  const logsPath = join(jingleHome, "logs")
  const logPath = join(logsPath, "jingle.log")
  const markerPath = join(logsPath, "process-session.json")
  mkdirSync(logsPath, { recursive: true })
  try {
    writeFileSync(
      logPath,
      `${JSON.stringify({
        dimensions: { appVersion: "0.0.1" },
        eventCode: "diagnostics.session_started",
        sessionId: "session-old"
      })}\n`
    )
    writeFileSync(
      markerPath,
      `${JSON.stringify({ schemaVersion: 1, sessionId: "session-old", startedAt: "old", terminal: null })}\n`
    )
    const initialLogSize = statSync(logPath).size
    writeFileSync(
      logPath,
      `${JSON.stringify({
        dimensions: { appVersion: "0.0.1" },
        eventCode: "diagnostics.session_started",
        sessionId: "session-old"
      })}\n${JSON.stringify({
        dimensions: { appVersion: "0.0.2", isPackaged: true, platform: process.platform },
        eventCode: "diagnostics.session_started",
        sessionId: "session-new"
      })}\n`
    )
    writeFileSync(
      markerPath,
      `${JSON.stringify({ schemaVersion: 1, sessionId: "session-new", startedAt: "new", terminal: null })}\n`
    )

    assert.deepEqual(
      await smokeModule.readDiagnosticsRuntimeIdentity(jingleHome, "session-old", initialLogSize),
      { appVersion: "0.0.2", isPackaged: true, platform: process.platform }
    )
  } finally {
    rmSync(jingleHome, { force: true, recursive: true })
  }
})

test("keeps the previous NSIS installation until current verification completes", async () => {
  const smokeModule = await smokeModulePromise
  const events: string[] = []
  const result = await smokeModule.withWindowsInPlaceUpgrade(
    {
      beforeCurrent: async () => {
        events.push("before-current")
      },
      currentArtifactPath: "current.exe",
      installRoot: "C:\\Jingle",
      logPath: "commands.log",
      previousArtifactPath: "previous.exe",
      runCurrent: async (installed, previousResult) => {
        events.push("verify-current-payload")
        events.push(
          `verify-current-version-ipc:${String(installed.version)}:${String(previousResult)}`
        )
        events.push("verify-current-db")
        return "current-result"
      },
      runPrevious: async (installed) => {
        events.push(`verify-previous:${String(installed.version)}`)
        return "previous-result"
      },
      workspace: "workspace"
    },
    {
      cleanup: async (input) => {
        events.push(`cleanup:${String((input.installed as { version: string }).version)}`)
      },
      createInvocation: (_platform, artifactPath, installRoot) => ({ artifactPath, installRoot }),
      install: async (invocation) => {
        const { artifactPath, installRoot } = invocation as {
          artifactPath: string
          installRoot: string
        }
        events.push(`install:${artifactPath}:${installRoot}`)
        return { version: artifactPath === "previous.exe" ? "previous" : "current" }
      }
    }
  )

  assert.deepEqual(result, {
    currentResult: "current-result",
    previousResult: "previous-result"
  })
  assert.deepEqual(events, [
    "install:previous.exe:C:\\Jingle",
    "verify-previous:previous",
    "before-current",
    "install:current.exe:C:\\Jingle",
    "verify-current-payload",
    "verify-current-version-ipc:current:previous-result",
    "verify-current-db",
    "cleanup:current"
  ])
})

test("reports both Windows upgrade verification and final cleanup failures", async () => {
  const smokeModule = await smokeModulePromise
  await assert.rejects(
    smokeModule.withWindowsInPlaceUpgrade(
      {
        beforeCurrent: async () => {},
        currentArtifactPath: "current.exe",
        installRoot: "C:\\Jingle",
        logPath: "commands.log",
        previousArtifactPath: "previous.exe",
        runCurrent: async () => {
          throw new Error("current verification failed")
        },
        runPrevious: async () => "previous-result",
        workspace: "workspace"
      },
      {
        cleanup: async () => {
          throw new Error("cleanup failed")
        },
        createInvocation: (_platform, artifactPath, installRoot) => ({ artifactPath, installRoot }),
        install: async (invocation) => ({
          version:
            (invocation as { artifactPath: string }).artifactPath === "previous.exe"
              ? "previous"
              : "current"
        })
      }
    ),
    (error) => {
      assert.ok(error instanceof AggregateError)
      assert.match(error.message, /Windows in-place upgrade and cleanup failed/)
      assert.deepEqual(
        error.errors.map((nestedError) => (nestedError as Error).message),
        ["current verification failed", "cleanup failed"]
      )
      return true
    }
  )
})

test("times out and reaps a child process without blocking exit delivery", async () => {
  const smokeModule = await smokeModulePromise
  const root = mkdtempSync(join(tmpdir(), "jingle-installed-smoke-process-"))
  const startedAt = Date.now()

  await assert.rejects(
    smokeModule.runProcess(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      cwd: root,
      logPath: join(root, "process.log"),
      timeoutMs: 50
    }),
    /timed out after 50 ms/
  )
  assert.ok(Date.now() - startedAt < 5_000)
})

test("fails closed when any persisted upgrade sentinel fact drifts", async () => {
  const smokeModule = await smokeModulePromise
  const sentinel = { threadId: "thread-old", title: "upgrade sentinel", token: "token-old" }
  const thread = {
    metadata: {
      releaseSmokeUpgradeSentinel: {
        schemaVersion: 1,
        sourceVersion: "0.0.1",
        token: sentinel.token
      }
    },
    threadId: sentinel.threadId,
    title: sentinel.title
  }

  assert.equal(smokeModule.assertUpgradeSentinelThread(thread, sentinel, "test"), thread)
  assert.throws(
    () =>
      smokeModule.assertUpgradeSentinelThread(
        { ...thread, threadId: "thread-new" },
        sentinel,
        "test"
      ),
    /invalid upgrade sentinel/
  )
  assert.throws(
    () => smokeModule.assertUpgradeSentinelThread({ ...thread, title: "other" }, sentinel, "test"),
    /invalid upgrade sentinel/
  )
  assert.throws(
    () =>
      smokeModule.assertUpgradeSentinelThread(
        {
          ...thread,
          metadata: {
            releaseSmokeUpgradeSentinel: {
              schemaVersion: 1,
              sourceVersion: "0.0.1",
              token: "other"
            }
          }
        },
        sentinel,
        "test"
      ),
    /invalid upgrade sentinel/
  )
})

test("release workflow keeps candidates build-only and publishes only verified tag assets", () => {
  const workflow = readFileSync(".github/workflows/desktop-release.yml", "utf8")
  const smokeStep = workflow.indexOf("- name: Run installed first-launch smoke")
  const diagnosticsStep = workflow.indexOf("- name: Upload installed smoke diagnostics")
  const stageAssetsStep = workflow.indexOf("- name: Stage verified release assets")
  const publishReleaseJob = workflow.indexOf("publish-release:")

  assert.ok(
    smokeStep >= 0 &&
      diagnosticsStep > smokeStep &&
      stageAssetsStep > diagnosticsStep &&
      publishReleaseJob > stageAssetsStep
  )
  assert.match(workflow, /push:[\s\S]*?tags:[\s\S]*?- "v\*\.\*\.\*"/)
  assert.match(workflow, /pnpm run release:smoke:installed/)
  assert.match(workflow, /xvfb-run --auto-servernum/)
  assert.match(workflow, /runner: ubuntu-24\.04/)
  assert.match(workflow, /sudo apt-get install --no-install-recommends --yes/)
  assert.match(workflow, /desktop-file-utils[\s\S]*?libfuse2t64[\s\S]*?xdg-utils/)
  assert.match(workflow, /\[\[ ! -c \/dev\/fuse \]\]/)
  assert.match(workflow, /fetch-depth: 0/)
  assert.match(workflow, /GITHUB_TOKEN: \$\{\{ secrets\.GITHUB_TOKEN \}\}/)
  assert.match(workflow, /--upgrade-baseline v0\.0\.1/)
  assert.match(workflow, /if: failure\(\)[\s\S]*?path: release-smoke-diagnostics/)
  assert.match(
    workflow,
    /- name: Stage verified release assets[\s\S]*?if: needs\.preflight\.outputs\.mode == 'publish'/
  )
  assert.match(workflow, /pattern: release-package-\*/)
  assert.match(workflow, /gh release upload "\$RELEASE_TAG" "\$\{assets\[@\]\}" --clobber/)
  assert.match(workflow, /gh release edit "\$RELEASE_TAG" --draft=false/)
  assert.match(workflow, /jingle-release-source:\$RELEASE_SHA/)
  assert.match(workflow, /This build is unsigned and not notarized/)
  assert.doesNotMatch(workflow, /gh release delete/)
  assert.match(workflow, /expected_arch: arm64[\s\S]*?expected_artifact_arch: arm64/)
  assert.match(workflow, /expected_arch: x64[\s\S]*?expected_artifact_arch: x64/)
  assert.match(workflow, /expected_arch: x64[\s\S]*?expected_artifact_arch: x86_64/)
  assert.match(workflow, /- name: Verify runner architecture/)
  assert.match(workflow, /RUNNER_ARCH: \$\{\{ runner\.arch \}\}/)
  assert.match(workflow, /node_arch="\$\(node -p 'process\.arch'\)"/)
  assert.match(workflow, /JINGLE_BUILD_TARGET_ARCH: \$\{\{ matrix\.expected_arch \}\}/)
  assert.match(workflow, /\$\{#packages\[@\]\} != 1 \|\| \$\{#expected_packages\[@\]\} != 1/)
  assert.match(workflow, /dist\/\*-mac-"\$EXPECTED_ARTIFACT_ARCH"\.dmg/)
  assert.match(workflow, /dist\/\*-win-"\$EXPECTED_ARTIFACT_ARCH"\.exe/)
  assert.match(workflow, /dist\/\*-linux-"\$EXPECTED_ARTIFACT_ARCH"\.AppImage/)
  assert.match(workflow, /Jingle-\$RELEASE_VERSION-mac-arm64\.dmg\.blockmap/)
  assert.match(workflow, /Jingle-\$RELEASE_VERSION-win-x64\.exe\.blockmap/)
  assert.match(workflow, /verify_update_metadata/)

  const smokeSource = readFileSync("scripts/release-smoke/installed.mjs", "utf8")
  assert.match(smokeSource, /chromium\.connectOverCDP/)
  assert.match(smokeSource, /reserveLoopbackPort/)
  assert.match(smokeSource, /\/json\/version/)
  assert.match(smokeSource, /JINGLE_REMOTE_DEBUGGING_PORT = String\(remoteDebuggingPort\)/)
  assert.match(smokeSource, /diagnostics\.session_started/)
  assert.match(smokeSource, /marker\?\.terminal\?\.kind !== "clean_exit"/)
  assert.match(smokeSource, /const child = spawn\(\s*executablePath/)
  assert.match(smokeSource, /launchArgs: \["--no-sandbox"\]/)
  assert.match(smokeSource, /Exec=\$\{installed\.executablePath\} --no-sandbox %U/)
  assert.match(smokeSource, /HKCU\\\\Software\\\\Classes\\\\jingle/)
  assert.match(smokeSource, /JINGLE_SMOKE_EXECUTABLE/)
  assert.match(smokeSource, /Installer-launched Jingle process did not exit/)
  assert.match(smokeSource, /CFBundleURLTypes/)
  assert.match(smokeSource, /assertMacProtocolDeclaration/)
  assert.match(smokeSource, /requireProtocolEntry: false/)
  assert.doesNotMatch(smokeSource, /_electron as electron/)
  assert.doesNotMatch(smokeSource, /APPIMAGE_EXTRACT_AND_RUN/)
  assert.match(smokeSource, /XDG_DATA_HOME/)

  assert.match(smokeSource, /\["default", desktopEntryName, "x-scheme-handler\/jingle"\]/)
  assert.match(smokeSource, /xdg-mime/)
  assert.match(smokeSource, /`--user-data-dir=\$\{userDataPath\}`/)
  assert.match(smokeSource, /delete env\.JINGLE_BDD/)
  assert.match(smokeSource, /delete process\.env\.GITHUB_TOKEN/)
  assert.match(smokeSource, /token: upgradeReleaseToken/)
  assert.match(smokeSource, /window\.api\.threads\.create/)
  assert.match(smokeSource, /workspacePath: sentinelRequest\.workspacePath/)
  assert.match(smokeSource, /workspacePath: join\(upgradeWorkspace, "sentinel-workspace"\)/)
  assert.match(smokeSource, /window\.api\.threads\.get/)
  assert.match(smokeSource, /window\.api\.threads\.list/)
  assert.match(smokeSource, /window\.api\.threads\.getAgentThreadData/)
  assert.match(smokeSource, /expectedWindowKind: baseline\.windowKind/)
  assert.match(smokeSource, /expectedWindowKind: "main"/)
  assert.doesNotMatch(smokeSource, /resolveMainWindow/)
  assert.match(smokeSource, /upgrade-previous-ipc-sentinel/)
  assert.match(smokeSource, /upgrade-current-ipc-verification/)
  assert.match(smokeSource, /upgradeMode === "nsis-in-place"/)
  assert.match(smokeSource, /withWindowsInPlaceUpgrade/)
  assert.match(smokeSource, /createWindowsPayloadInventory/)
  assert.match(smokeSource, /data-only-reinstall/)
  assert.match(smokeSource, /verifyUpgradeDatabase\(upgradeHome, sentinel\)/)
  assert.match(smokeSource, /FROM thread_workspace_bindings WHERE thread_id = \?/)
  assert.match(smokeSource, /expectedVersion: "0\.0\.1"/)

  const freshInventory = smokeSource.indexOf(
    "freshWindowsPayloadInventory = createWindowsPayloadInventory(installed.appRoot)"
  )
  const currentOperation = smokeSource.indexOf("const runCurrent = async")
  const upgradedInventory = smokeSource.indexOf(
    "assertWindowsPayloadMatchesFreshInstall(",
    currentOperation
  )
  const databaseVerification = smokeSource.indexOf(
    "await verifyUpgradeDatabase(upgradeHome, sentinel)",
    currentOperation
  )
  const windowsUpgrade = smokeSource.indexOf(
    "const result = await withWindowsInPlaceUpgrade",
    currentOperation
  )
  assert.ok(freshInventory >= 0 && freshInventory < currentOperation)
  assert.ok(upgradedInventory > currentOperation && upgradedInventory < windowsUpgrade)
  assert.ok(databaseVerification > currentOperation && databaseVerification < windowsUpgrade)
})
