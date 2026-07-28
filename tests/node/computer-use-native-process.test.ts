import assert from "node:assert/strict"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import {
  ComputerUseNativeProcessError,
  createComputerUseNativeInvocation,
  createComputerUseNativeProcessBridge,
  resolveComputerUseBackendEnvironment
} from "../../src/main/computer-use/native-process"

test("native process bridge sends one bounded stdin frame without argv payloads", async () => {
  const directory = await mkdtemp(join(tmpdir(), "jingle-computer-use-transport-"))
  const helper = join(directory, "helper.mjs")
  await writeFile(
    helper,
    `
const chunks = []
for await (const chunk of process.stdin) chunks.push(chunk)
if (process.argv.length !== 2) process.exit(41)
const request = JSON.parse(Buffer.concat(chunks).toString("utf8"))
process.stdout.write(JSON.stringify({ request }))
`,
    "utf8"
  )
  try {
    const bridge = createComputerUseNativeProcessBridge({
      environment: "macos-quartz",
      invocation: { args: [helper], command: process.execPath }
    })
    const request = {
      environment: "macos-quartz",
      method: "probe",
      protocolVersion: 1,
      requestPermission: true
    } as const
    assert.deepEqual(await bridge.invoke(request), { request })
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
})

test("native process bridge honors cancellation before spawn and while running", async () => {
  let spawnCalls = 0
  const preAborted = new AbortController()
  preAborted.abort(new DOMException("pre-aborted", "AbortError"))
  const bridge = createComputerUseNativeProcessBridge({
    environment: "macos-quartz",
    invocation: { args: [], command: "/does/not/exist" },
    spawnProcess: (() => {
      spawnCalls += 1
      throw new Error("must not spawn")
    }) as never
  })
  await assert.rejects(
    bridge.invoke(
      {
        environment: "macos-quartz",
        method: "probe",
        protocolVersion: 1,
        requestPermission: true
      },
      preAborted.signal
    ),
    /pre-aborted/
  )
  assert.equal(spawnCalls, 0)

  const directory = await mkdtemp(join(tmpdir(), "jingle-computer-use-abort-"))
  const helper = join(directory, "helper.mjs")
  await writeFile(helper, `process.stdin.resume(); setTimeout(() => {}, 60000)`, "utf8")
  try {
    const runningBridge = createComputerUseNativeProcessBridge({
      environment: "macos-quartz",
      invocation: { args: [helper], command: process.execPath }
    })
    const controller = new AbortController()
    const invocation = runningBridge.invoke(
      {
        environment: "macos-quartz",
        method: "probe",
        protocolVersion: 1,
        requestPermission: true
      },
      controller.signal
    )
    controller.abort(new DOMException("stopped", "AbortError"))
    await assert.rejects(invocation, /stopped/)
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
})

test("native process bridge rejects environment drift and invalid response frames", async () => {
  const directory = await mkdtemp(join(tmpdir(), "jingle-computer-use-invalid-frame-"))
  const helper = join(directory, "helper.mjs")
  await writeFile(helper, `process.stdin.resume(); process.stdout.write("{}\\n{}")`, "utf8")
  try {
    const bridge = createComputerUseNativeProcessBridge({
      environment: "macos-quartz",
      invocation: { args: [helper], command: process.execPath }
    })
    await assert.rejects(
      bridge.invoke({
        environment: "windows-win32",
        method: "probe",
        protocolVersion: 1,
        requestPermission: false
      }),
      /another environment/
    )
    await assert.rejects(
      bridge.invoke({
        environment: "macos-quartz",
        method: "probe",
        protocolVersion: 1,
        requestPermission: true
      }),
      (error: unknown) =>
        error instanceof ComputerUseNativeProcessError && error.code === "invalid_response"
    )
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
})

test("native process bridge preserves bounded diagnostic codes without raw stderr", async () => {
  const directory = await mkdtemp(join(tmpdir(), "jingle-computer-use-diagnostic-"))
  const helper = join(directory, "helper.mjs")
  await writeFile(
    helper,
    `process.stdin.resume(); process.stderr.write(JSON.stringify({code:"accessibility_permission_required",message:"private path /Users/example and token secret"}) + "\\n"); process.exitCode = 2`,
    "utf8"
  )
  try {
    const bridge = createComputerUseNativeProcessBridge({
      environment: "macos-quartz",
      invocation: { args: [helper], command: process.execPath }
    })
    await assert.rejects(
      bridge.invoke({
        environment: "macos-quartz",
        method: "probe",
        protocolVersion: 1,
        requestPermission: true
      }),
      (error: unknown) => {
        assert.ok(error instanceof ComputerUseNativeProcessError)
        assert.equal(error.code, "permission_required")
        assert.equal(error.nativeCode, "accessibility_permission_required")
        assert.equal(error.message.includes("/Users/example"), false)
        assert.equal(error.message.includes("secret"), false)
        return true
      }
    )
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
})

test("native platform and invocation selection is explicit", () => {
  assert.equal(resolveComputerUseBackendEnvironment("darwin", {}), "macos-quartz")
  assert.equal(resolveComputerUseBackendEnvironment("win32", {}), "windows-win32")
  assert.equal(resolveComputerUseBackendEnvironment("linux", {}), "linux-x11")
  assert.equal(
    resolveComputerUseBackendEnvironment("linux", {
      WAYLAND_DISPLAY: "wayland-0",
      XDG_CURRENT_DESKTOP: "GNOME"
    }),
    "linux-wayland-gnome"
  )
  assert.equal(resolveComputerUseBackendEnvironment("aix", {}), null)
  assert.deepEqual(createComputerUseNativeInvocation("macos-quartz", "/helper"), {
    args: [],
    command: "/helper"
  })
  assert.deepEqual(createComputerUseNativeInvocation("linux-x11", "/helper.py"), {
    args: ["/helper.py"],
    command: "/usr/bin/python3"
  })
})
