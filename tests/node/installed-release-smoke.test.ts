import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import test from "node:test"

interface InstalledSmokeModule {
  createInstallerInvocation(
    platform: string,
    artifactPath: string,
    installRoot: string
  ): Record<string, unknown>
  runProcess(
    command: string,
    args: string[],
    options: { cwd: string; logPath: string; timeoutMs: number }
  ): Promise<void>
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

test("release candidate workflow uses the installed smoke owner without uploading packages", () => {
  const workflow = readFileSync(".github/workflows/desktop-release.yml", "utf8")
  const smokeStep = workflow.indexOf("- name: Run installed first-launch smoke")
  const diagnosticsStep = workflow.indexOf("- name: Upload installed smoke diagnostics")

  assert.ok(smokeStep >= 0 && diagnosticsStep > smokeStep)
  assert.match(workflow, /pnpm run release:smoke:installed/)
  assert.match(workflow, /xvfb-run --auto-servernum/)
  assert.match(workflow, /if: failure\(\)[\s\S]*?path: release-smoke-diagnostics/)
  assert.doesNotMatch(workflow, /path: [^\n]*(?:\.dmg|\.exe|\.AppImage)/)

  const smokeSource = readFileSync("scripts/release-smoke/installed.mjs", "utf8")
  assert.match(smokeSource, /chromiumSandbox: true/)
  assert.match(smokeSource, /`--user-data-dir=\$\{userDataPath\}`/)
  assert.match(smokeSource, /delete env\.JINGLE_BDD/)
})
