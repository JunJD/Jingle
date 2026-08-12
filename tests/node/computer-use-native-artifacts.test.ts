import assert from "node:assert/strict"
import { spawn, spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
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

interface NativeOperationResponse {
  environment: string
  method: "execute" | "identify" | "observe"
  protocolVersion: number
  result: unknown
}

const repositoryRoot = process.cwd()
const nativeSourceDirectory = resolve(repositoryRoot, "packages/computer-use-core/src/native")
const macParentLifetimeSource = resolve(
  nativeSourceDirectory,
  "jingle-computer-use-parent-lifetime.swift"
)

function runJson(
  executable: string,
  args: readonly string[],
  environment: NodeJS.ProcessEnv = {
    ...process.env,
    JINGLE_PARENT_PID: String(process.pid)
  }
): unknown {
  const request = args.at(-1)
  assert.ok(request)
  JSON.parse(request)
  const result = spawnSync(executable, args.slice(0, -1), {
    encoding: "utf8",
    env: environment,
    input: request
  })
  assert.equal(result.status, 0, result.stderr || result.error?.message)
  assert.equal(result.stderr, "")
  return JSON.parse(result.stdout)
}

function runJsonFailure(
  executable: string,
  args: readonly string[],
  environment: NodeJS.ProcessEnv = {
    ...process.env,
    JINGLE_PARENT_PID: String(process.pid)
  }
): string {
  const request = args.at(-1)
  assert.ok(request)
  JSON.parse(request)
  const result = spawnSync(executable, args.slice(0, -1), {
    encoding: "utf8",
    env: environment,
    input: request
  })
  assert.notEqual(result.status, 0)
  assert.equal(result.stdout, "")
  return result.stderr
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
    ["activate", "press", "set_value", "type_text", "keypress", "scroll"]
  )
}

function assertRawOperationResponse(
  value: unknown,
  expected: Pick<NativeOperationResponse, "environment" | "method">
): asserts value is NativeOperationResponse {
  assert.ok(value && typeof value === "object" && !Array.isArray(value))
  assert.deepEqual(Object.keys(value).sort(), [
    "environment",
    "method",
    "protocolVersion",
    "result"
  ])
  const response = value as NativeOperationResponse
  assert.equal(response.environment, expected.environment)
  assert.equal(response.method, expected.method)
  assert.equal(response.protocolVersion, 1)
}

test("native artifact packaging contains only the Computer Use helpers", () => {
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
  assert.equal(packageJson.files.includes("out/native/jingle-desktop-automation"), false)

  const buildScript = readFileSync(
    resolve(repositoryRoot, "scripts/build-native-island.mjs"),
    "utf8"
  )
  for (const artifact of artifacts) {
    assert.ok(buildScript.includes(artifact.replace("out/native/", "")))
  }
  assert.match(buildScript, /jingle-computer-use-parent-lifetime\.swift/)
  assert.equal(buildScript.includes("jingle-desktop-automation"), false)
})

test("native helpers reject request payloads passed through argv", () => {
  const request = JSON.stringify({ environment: "linux-x11", method: "probe" })
  const linux = spawnSync(
    process.env.PYTHON ?? "python3",
    [resolve(nativeSourceDirectory, "jingle-computer-use-linux.py"), request],
    { encoding: "utf8" }
  )
  assert.notEqual(linux.status, 0)
  assert.equal(linux.stdout, "")
  assert.match(linux.stderr, /stdin/i)
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

  const execution = runJson(
    process.env.PYTHON ?? "python3",
    [
      sourcePath,
      JSON.stringify({
        environment: "linux-wayland-gnome",
        method: "execute",
        protocolVersion: 1,
        request: { base: { stateId: "state-test" } }
      })
    ],
    waylandEnvironment
  )
  assertRawOperationResponse(execution, {
    environment: "linux-wayland-gnome",
    method: "execute"
  })
  assert.deepEqual(execution.result, {
    baseStateId: "state-test",
    outcome: "unavailable",
    steps: []
  })

  for (const request of [
    {
      environment: "linux-x11",
      method: "execute",
      protocolVersion: 1,
      request: { base: { stateId: "state-test" } }
    },
    {
      environment: "linux-wayland-gnome",
      method: "execute",
      protocolVersion: 2,
      request: { base: { stateId: "state-test" } }
    },
    {
      environment: "linux-wayland-gnome",
      method: "execute",
      protocolVersion: true,
      request: { base: { stateId: "state-test" } }
    },
    {
      environment: "linux-wayland-gnome",
      method: "execute",
      protocolVersion: "1",
      request: { base: { stateId: "state-test" } }
    }
  ]) {
    assert.match(
      runJsonFailure(
        process.env.PYTHON ?? "python3",
        [sourcePath, JSON.stringify(request)],
        waylandEnvironment
      ),
      /another environment or protocol/
    )
  }

  const unsupportedEnvironment = {
    ...process.env,
    XDG_CURRENT_DESKTOP: "",
    XDG_SESSION_TYPE: "tty"
  }
  for (const request of [
    { environment: "linux-x11", method: "probe" },
    {
      environment: "linux-x11",
      method: "execute",
      protocolVersion: 1,
      request: { base: { stateId: "state-test" } }
    }
  ]) {
    assert.match(
      runJsonFailure(
        process.env.PYTHON ?? "python3",
        [sourcePath, JSON.stringify(request)],
        unsupportedEnvironment
      ),
      /supported Linux session environment/
    )
  }
})

test("Windows helper pins its JSON wire to UTF-8 before reading requests", () => {
  const source = readFileSync(
    resolve(nativeSourceDirectory, "jingle-computer-use-windows.ps1"),
    "utf8"
  )
  assert.match(source, /UTF8Encoding\(\$false\)/)
  assert.match(source, /\[Console\]::InputEncoding = \$JingleComputerUseUtf8/)
  assert.match(source, /\[Console\]::OutputEncoding = \$JingleComputerUseUtf8/)
  assert.match(source, /\$rawEnvironment -isnot \[string\]/)
  assert.match(source, /\$rawProtocolVersion -is \[int\]/)
  assert.match(source, /\$Envelope\.PSObject\.Properties\["environment"\]/)
  assert.match(source, /\$Envelope\.PSObject\.Properties\["protocolVersion"\]/)
  assert.match(source, /\$envelope\.PSObject\.Properties\["method"\]/)
  assert.match(source, /switch -CaseSensitive \(\$method\)/)
  assert.ok(
    source.indexOf("[Console]::OutputEncoding") < source.indexOf("[Console]::In.ReadToEnd()")
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
          macParentLifetimeSource,
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
        JSON.stringify({
          environment: "macos-quartz",
          method: "probe",
          protocolVersion: 1,
          requestPermission: false
        })
      ])
      assertRawCapabilityMatrix(probe, {
        environment: "macos-quartz",
        platform: "macos"
      })
      assert.deepEqual(
        probe.capabilities.map((capability) => capability.route),
        ["ax_raise_activate", "ax_action", "ax_value", "ax_value", "unavailable", "unavailable"]
      )
      assert.equal(
        runJson(binaryPath, [
          JSON.stringify({ method: "dispose_session", sessionId: "session-test" })
        ]),
        null
      )
      assert.match(
        runJsonFailure(binaryPath, [
          JSON.stringify({
            environment: "windows-win32",
            method: "observe",
            protocolVersion: 1,
            request: {}
          })
        ]),
        /another environment or protocol/
      )
    } finally {
      rmSync(temporaryDirectory, { force: true, recursive: true })
    }
  }
)

test(
  "macOS helper exits when its direct Electron owner dies",
  { skip: process.platform !== "darwin" },
  async () => {
    const temporaryDirectory = mkdtempSync(join(tmpdir(), "jingle-computer-use-parent-death-"))
    const harnessPath = resolve(temporaryDirectory, "parent-lifetime-harness")
    const harnessSource = resolve(temporaryDirectory, "ParentLifetimeHarness.swift")
    const parentSource = resolve(temporaryDirectory, "parent.mjs")
    const markerPath = resolve(temporaryDirectory, "side-effect-marker")
    try {
      writeFileSync(
        harnessSource,
        `
import Darwin
import Foundation

@main
private enum ParentLifetimeHarness {
    static func main() throws {
        let guardOwner = try JingleParentLifetimeGuard()
        try withExtendedLifetime(guardOwner) {
            print("ready:\\(getpid())")
            fflush(stdout)
            // The held operation deliberately never calls assertAlive again;
            // the independent kqueue monitor must terminate it with the parent.
            Thread.sleep(forTimeInterval: 2)
            try Data("unsafe".utf8).write(to: URL(fileURLWithPath: ProcessInfo.processInfo.environment["JINGLE_TEST_MARKER"]!))
        }
    }
}
`,
        "utf8"
      )
      const compile = spawnSync(
        "swiftc",
        ["-parse-as-library", "-O", macParentLifetimeSource, harnessSource, "-o", harnessPath],
        { encoding: "utf8" }
      )
      assert.equal(compile.status, 0, compile.stderr || compile.error?.message)
      writeFileSync(
        parentSource,
        `
import { spawn } from "node:child_process"
const helper = spawn(process.env.JINGLE_TEST_HELPER, [], {
  env: { ...process.env, JINGLE_PARENT_PID: String(process.pid) },
  stdio: ["ignore", "pipe", "inherit"]
})
helper.stdout.once("data", (chunk) => process.stdout.write(chunk))
setInterval(() => {}, 60_000)
`,
        "utf8"
      )

      const parent = spawn(process.execPath, [parentSource], {
        env: {
          ...process.env,
          JINGLE_PARENT_PID: "2",
          JINGLE_TEST_HELPER: harnessPath,
          JINGLE_TEST_MARKER: markerPath
        },
        stdio: ["ignore", "pipe", "pipe"]
      })
      const helperPid = await new Promise<number>((resolvePid, rejectPid) => {
        const timeout = setTimeout(() => rejectPid(new Error("helper did not become ready")), 5_000)
        parent.once("error", rejectPid)
        parent.stdout.once("data", (chunk) => {
          clearTimeout(timeout)
          const match = /^ready:(\d+)/.exec(String(chunk))
          if (!match) rejectPid(new Error(`unexpected helper readiness: ${String(chunk)}`))
          else resolvePid(Number(match[1]))
        })
      })
      assert.equal(parent.kill("SIGKILL"), true)
      await new Promise<void>((resolveClose) => parent.once("close", () => resolveClose()))

      const deadline = Date.now() + 5_000
      while (Date.now() < deadline) {
        try {
          process.kill(helperPid, 0)
        } catch {
          break
        }
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 20))
      }
      assert.throws(() => process.kill(helperPid, 0))
      assert.equal(existsSync(markerPath), false)
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

    const execution = runJson("powershell.exe", [
      ...powershellArgs,
      JSON.stringify({
        environment: "windows-win32",
        method: "execute",
        protocolVersion: 1,
        request: { base: { stateId: "state-test" } }
      })
    ])
    assertRawOperationResponse(execution, {
      environment: "windows-win32",
      method: "execute"
    })
    assert.deepEqual(execution.result, {
      baseStateId: "state-test",
      outcome: "unavailable",
      steps: []
    })
    assert.match(
      runJsonFailure("powershell.exe", [
        ...powershellArgs,
        JSON.stringify({
          environment: "macos-quartz",
          method: "execute",
          protocolVersion: 1,
          request: { base: { stateId: "state-test" } }
        })
      ]),
      /another environment or protocol/
    )
    for (const [request, pattern] of [
      [
        {
          environment: "windows-win32",
          method: "execute",
          protocolVersion: true,
          request: { base: { stateId: "state-test" } }
        },
        /another environment or protocol/
      ],
      [
        {
          environment: "windows-win32",
          method: "execute",
          protocolVersion: [1],
          request: { base: { stateId: "state-test" } }
        },
        /another environment or protocol/
      ],
      [
        {
          environment: "windows-win32",
          method: "execute",
          protocolVersion: "1",
          request: { base: { stateId: "state-test" } }
        },
        /another environment or protocol/
      ],
      [
        {
          environment: ["windows-win32"],
          method: "execute",
          protocolVersion: 1,
          request: { base: { stateId: "state-test" } }
        },
        /another environment or protocol/
      ],
      [
        {
          environment: "windows-win32",
          method: ["execute"],
          protocolVersion: 1,
          request: { base: { stateId: "state-test" } }
        },
        /method must be a string/
      ]
    ] as const) {
      assert.match(
        runJsonFailure("powershell.exe", [...powershellArgs, JSON.stringify(request)]),
        pattern
      )
    }
  }
)
