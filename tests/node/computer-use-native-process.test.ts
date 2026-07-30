import assert from "node:assert/strict"
import type { ChildProcessWithoutNullStreams } from "node:child_process"
import { EventEmitter } from "node:events"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { PassThrough } from "node:stream"
import test from "node:test"
import {
  ComputerUseNativeProcessError,
  createComputerUseNativeInvocation,
  createComputerUseNativeProcessBridge,
  resolveComputerUseBackendEnvironment
} from "../../src/main/computer-use/native-process"

function controlledTerminationChild(): {
  child: ChildProcessWithoutNullStreams
  signals: string[]
} {
  const signals: string[] = []
  const child = new EventEmitter() as ChildProcessWithoutNullStreams
  Object.assign(child, {
    stderr: new PassThrough(),
    stdin: new PassThrough(),
    stdout: new PassThrough()
  })
  child.kill = ((signal?: NodeJS.Signals | number) => {
    signals.push(typeof signal === "string" ? signal : "SIGTERM")
    if (signal === undefined) {
      setImmediate(() => child.emit("error", new Error("termination in progress")))
    } else if (signal === "SIGKILL") {
      setImmediate(() => child.emit("close", null, "SIGKILL"))
    }
    return true
  }) as ChildProcessWithoutNullStreams["kill"]
  return { child, signals }
}

function unconfirmedTerminationChild(
  behavior: "descendant-pipe" | "kill-false" | "kill-throws" | "never-close"
): {
  child: ChildProcessWithoutNullStreams
  signals: string[]
} {
  const signals: string[] = []
  const child = new EventEmitter() as ChildProcessWithoutNullStreams
  Object.assign(child, {
    stderr: new PassThrough(),
    stdin: new PassThrough(),
    stdout: new PassThrough()
  })
  child.kill = ((signal?: NodeJS.Signals | number) => {
    signals.push(typeof signal === "string" ? signal : "SIGTERM")
    if (behavior === "kill-throws") throw new Error("kill failed")
    if (behavior === "descendant-pipe" && signal === "SIGKILL") {
      setImmediate(() => child.emit("exit", null, "SIGKILL"))
    }
    return behavior !== "kill-false"
  }) as ChildProcessWithoutNullStreams["kill"]
  return { child, signals }
}

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

test("native process bridge confirms helper termination before reporting cancellation", async () => {
  const { child, signals } = controlledTerminationChild()
  const bridge = createComputerUseNativeProcessBridge({
    environment: "macos-quartz",
    invocation: { args: [], command: "/controlled-helper" },
    spawnProcess: (() => child) as never
  })
  const controller = new AbortController()
  const abortReason = new DOMException("cancelled after dispatch", "AbortError")
  let rejected = false
  const invocation = bridge
    .invoke(
      {
        environment: "macos-quartz",
        method: "probe",
        protocolVersion: 1,
        requestPermission: true
      },
      controller.signal
    )
    .catch((error: unknown) => {
      rejected = true
      throw error
    })

  controller.abort(abortReason)
  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.equal(rejected, false)
  await assert.rejects(invocation, (error) => error === abortReason)
  assert.deepEqual(signals, ["SIGTERM", "SIGKILL"])
})

test("native process bridge preserves typed timeout until helper termination is confirmed", async () => {
  const { child, signals } = controlledTerminationChild()
  const bridge = createComputerUseNativeProcessBridge({
    environment: "macos-quartz",
    invocation: { args: [], command: "/controlled-helper" },
    spawnProcess: (() => child) as never,
    timeoutMs: 1_000
  })

  await assert.rejects(
    bridge.invoke({
      environment: "macos-quartz",
      method: "probe",
      protocolVersion: 1,
      requestPermission: true
    }),
    (error: unknown) => error instanceof ComputerUseNativeProcessError && error.code === "timeout"
  )
  assert.deepEqual(signals, ["SIGTERM", "SIGKILL"])
})

test("native process bridge bounds unconfirmed helper termination paths", async () => {
  const fixtures = (["never-close", "kill-false", "kill-throws", "descendant-pipe"] as const).map(
    (behavior) => {
      const { child, signals } = unconfirmedTerminationChild(behavior)
      const bridge = createComputerUseNativeProcessBridge({
        environment: "macos-quartz",
        invocation: { args: [], command: `/controlled-${behavior}` },
        spawnProcess: (() => child) as never
      })
      const controller = new AbortController()
      const invocation = bridge.invoke(
        {
          environment: "macos-quartz",
          method: "probe",
          protocolVersion: 1,
          requestPermission: true
        },
        controller.signal
      )
      controller.abort(new DOMException(`cancelled ${behavior}`, "AbortError"))
      return { behavior, invocation, signals }
    }
  )

  await Promise.all(
    fixtures.map(async ({ behavior, invocation, signals }) => {
      await assert.rejects(invocation, (error: unknown) => {
        assert.ok(error instanceof ComputerUseNativeProcessError, behavior)
        assert.equal(error.code, "helper_termination_unconfirmed", behavior)
        assert.equal(error.successorObservationSafe, false, behavior)
        return true
      })
      assert.deepEqual(signals, ["SIGTERM", "SIGKILL"], behavior)
    })
  )
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
