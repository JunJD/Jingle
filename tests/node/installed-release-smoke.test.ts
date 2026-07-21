import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import test from "node:test"

interface InstalledSmokeModule {
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
  createUpgradeInstallMode(platform: string): "data-only-reinstall" | "nsis-in-place"
  createWindowsPayloadInventory(root: string): {
    payload: Array<{ path: string; sha256: string; size: number }>
    uninstaller: { path: string; sha256: string; size: number }
  }
  runProcess(
    command: string,
    args: string[],
    options: { cwd: string; logPath: string; timeoutMs: number }
  ): Promise<void>
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
  selectMountedMacApp(mountPath: string): string
  selectInstallerArtifact(root: string, platform: string): string
}

const moduleUrl = pathToFileURL(join(process.cwd(), "scripts/release-smoke/installed.mjs")).href
const smokeModulePromise = import(moduleUrl) as Promise<InstalledSmokeModule>

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

test("release candidate workflow uses the installed smoke owner without uploading packages", () => {
  const workflow = readFileSync(".github/workflows/desktop-release.yml", "utf8")
  const smokeStep = workflow.indexOf("- name: Run installed first-launch smoke")
  const diagnosticsStep = workflow.indexOf("- name: Upload installed smoke diagnostics")

  assert.ok(smokeStep >= 0 && diagnosticsStep > smokeStep)
  assert.match(workflow, /pnpm run release:smoke:installed/)
  assert.match(workflow, /xvfb-run --auto-servernum/)
  assert.match(workflow, /fetch-depth: 0/)
  assert.match(workflow, /GITHUB_TOKEN: \$\{\{ secrets\.GITHUB_TOKEN \}\}/)
  assert.match(workflow, /--upgrade-baseline v0\.0\.1/)
  assert.match(workflow, /if: failure\(\)[\s\S]*?path: release-smoke-diagnostics/)
  assert.doesNotMatch(workflow, /path: [^\n]*(?:\.dmg|\.exe|\.AppImage)/)
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

  const smokeSource = readFileSync("scripts/release-smoke/installed.mjs", "utf8")
  assert.match(smokeSource, /chromiumSandbox: true/)
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
