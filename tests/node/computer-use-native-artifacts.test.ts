import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import test from "node:test"

interface NativeCapability {
  action: string
  background: "verified" | "refused" | "unavailable"
  foreground: "verified" | "refused" | "unavailable"
  route: string
}

interface NativeCapabilityMatrix {
  capabilities: NativeCapability[]
  environment: string
  platform: string
  protocolVersion: number
}

const repositoryRoot = process.cwd()
const nativeSourceDirectory = resolve(repositoryRoot, "packages/computer-use-core/src/native")

function runJson(
  executable: string,
  args: readonly string[],
  environment: NodeJS.ProcessEnv = process.env
): unknown {
  const result = spawnSync(executable, args, {
    encoding: "utf8",
    env: environment
  })
  assert.equal(result.status, 0, result.stderr || result.error?.message)
  assert.equal(result.stderr, "")
  return JSON.parse(result.stdout)
}

function assertRawCapabilityMatrix(
  value: unknown,
  expected: Pick<NativeCapabilityMatrix, "environment" | "platform">
): asserts value is NativeCapabilityMatrix {
  assert.ok(value && typeof value === "object" && !Array.isArray(value))
  assert.equal("ok" in value, false)
  assert.equal("result" in value, false)
  const matrix = value as NativeCapabilityMatrix
  assert.equal(matrix.environment, expected.environment)
  assert.equal(matrix.platform, expected.platform)
  assert.equal(matrix.protocolVersion, 1)
  assert.deepEqual(
    matrix.capabilities.map((capability) => capability.action),
    ["press", "set_value", "type_text", "keypress", "scroll"]
  )
}

test("native artifact packaging is additive and retains the legacy helper", () => {
  const packageJson = JSON.parse(readFileSync(resolve(repositoryRoot, "package.json"), "utf8")) as {
    files: string[]
  }
  const artifacts = [
    "out/native/jingle-computer-use-linux.py",
    "out/native/jingle-computer-use-macos",
    "out/native/jingle-computer-use-windows.ps1"
  ]
  for (const artifact of artifacts) {
    assert.ok(packageJson.files.includes(artifact), `missing package artifact ${artifact}`)
  }
  assert.ok(packageJson.files.includes("out/native/jingle-desktop-automation"))

  const buildScript = readFileSync(
    resolve(repositoryRoot, "scripts/build-native-island.mjs"),
    "utf8"
  )
  for (const artifact of artifacts) {
    assert.ok(buildScript.includes(artifact.replace("out/native/", "")))
  }
})

test("Linux probes are raw, environment-bound, and fail closed", () => {
  const sourcePath = resolve(nativeSourceDirectory, "jingle-computer-use-linux.py")
  const waylandEnvironment = {
    ...process.env,
    XDG_CURRENT_DESKTOP: "GNOME",
    XDG_SESSION_TYPE: "wayland"
  }
  const mismatch = runJson(
    process.env.PYTHON ?? "python3",
    [sourcePath, JSON.stringify({ environment: "linux-x11", method: "probe" })],
    waylandEnvironment
  )
  assertRawCapabilityMatrix(mismatch, { environment: "linux-x11", platform: "linux" })
  assert.equal(
    mismatch.capabilities.some((capability) => capability.background === "verified"),
    false
  )

  const wayland = runJson(
    process.env.PYTHON ?? "python3",
    [sourcePath, JSON.stringify({ environment: "linux-wayland-gnome", method: "probe" })],
    waylandEnvironment
  )
  assertRawCapabilityMatrix(wayland, {
    environment: "linux-wayland-gnome",
    platform: "linux"
  })
  assert.equal(
    wayland.capabilities.some((capability) => capability.background === "verified"),
    false
  )

  assert.deepEqual(
    runJson(
      process.env.PYTHON ?? "python3",
      [
        sourcePath,
        JSON.stringify({
          method: "execute",
          request: { base: { stateId: "state-test" } }
        })
      ],
      waylandEnvironment
    ),
    { baseStateId: "state-test", outcome: "unavailable", steps: [] }
  )
})

test(
  "macOS helper compiles and emits the canonical raw probe",
  { skip: process.platform !== "darwin" },
  () => {
    const temporaryDirectory = mkdtempSync(join(tmpdir(), "jingle-computer-use-macos-"))
    const binaryPath = resolve(temporaryDirectory, "jingle-computer-use-macos")
    try {
      const compile = spawnSync(
        "swiftc",
        [
          "-parse-as-library",
          "-O",
          resolve(nativeSourceDirectory, "jingle-computer-use-macos.swift"),
          "-o",
          binaryPath,
          "-framework",
          "AppKit",
          "-framework",
          "ApplicationServices"
        ],
        { encoding: "utf8" }
      )
      assert.equal(compile.status, 0, compile.stderr || compile.error?.message)

      const probe = runJson(binaryPath, [
        JSON.stringify({ environment: "macos-quartz", method: "probe" })
      ])
      assertRawCapabilityMatrix(probe, {
        environment: "macos-quartz",
        platform: "macos"
      })
      assert.deepEqual(
        probe.capabilities.map((capability) => capability.route),
        ["ax_action", "ax_value", "ax_value", "unavailable", "unavailable"]
      )
      assert.equal(
        runJson(binaryPath, [
          JSON.stringify({ method: "dispose_session", sessionId: "session-test" })
        ]),
        null
      )
    } finally {
      rmSync(temporaryDirectory, { force: true, recursive: true })
    }
  }
)

test(
  "Windows helper probe and direct execution remain fail closed",
  { skip: process.platform !== "win32" },
  () => {
    const sourcePath = resolve(nativeSourceDirectory, "jingle-computer-use-windows.ps1")
    const powershellArgs = [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      sourcePath
    ]
    const probe = runJson("powershell.exe", [
      ...powershellArgs,
      JSON.stringify({ environment: "windows-win32", method: "probe" })
    ])
    assertRawCapabilityMatrix(probe, {
      environment: "windows-win32",
      platform: "windows"
    })
    assert.equal(
      probe.capabilities.some((capability) => capability.background === "verified"),
      false
    )

    assert.deepEqual(
      runJson("powershell.exe", [
        ...powershellArgs,
        JSON.stringify({
          method: "execute",
          request: { base: { stateId: "state-test" } }
        })
      ]),
      { baseStateId: "state-test", outcome: "unavailable", steps: [] }
    )
  }
)
