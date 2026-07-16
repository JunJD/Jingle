import { execFileSync, spawn, type ChildProcess } from "node:child_process"
import { existsSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { app } from "electron"
import { resolveNativeBinaryPath } from "./native-binary-path"

export type NativeMinimalIslandState = "idle" | "working" | "approval"
export type NativeMinimalIslandAction = "openLauncher" | "openMainWindow" | "openSettings" | "quit"

export interface NativeMinimalIslandActionHandlers {
  openLauncher: () => void
  openMainWindow: () => void
  openSettings: () => void
  quit: () => void
}

let nativeIslandProcess: ChildProcess | null = null
let nativeIslandStdoutBuffer = ""
let nativeIslandActionHandlers: NativeMinimalIslandActionHandlers | null = null

function resolveNativeIslandBinaryPath(): string | null {
  return resolveNativeBinaryPath({
    candidates: {
      appPath: join(app.getAppPath(), "out/native/jingle-minimal-island"),
      compiledPath: join(__dirname, "..", "native", "jingle-minimal-island"),
      cwdPath: join(process.cwd(), "out/native/jingle-minimal-island")
    },
    isPackaged: app.isPackaged
  })
}

function resolveSwiftSourcePath(): string | null {
  const candidates = [
    join(app.getAppPath(), "src/native/jingle-minimal-island.swift"),
    join(process.cwd(), "src/native/jingle-minimal-island.swift"),
    join(__dirname, "..", "..", "src", "native", "jingle-minimal-island.swift"),
    join(app.getAppPath(), "out/native/jingle-minimal-island.swift"),
    join(process.cwd(), "out/native/jingle-minimal-island.swift"),
    join(__dirname, "..", "native", "jingle-minimal-island.swift")
  ]

  return candidates.find((candidate) => existsSync(candidate)) ?? null
}

function compileNativeIsland(sourcePath: string): string {
  const nativeDir = join(app.getPath("userData"), "native")
  const binaryPath = join(nativeDir, "jingle-minimal-island")

  mkdirSync(nativeDir, { recursive: true })
  execFileSync("swiftc", [
    "-parse-as-library",
    "-O",
    sourcePath,
    "-o",
    binaryPath,
    "-framework",
    "AppKit"
  ])

  return binaryPath
}

function ensureNativeIslandBinary(): string | null {
  const binaryPath = resolveNativeIslandBinaryPath()
  if (binaryPath) {
    return binaryPath
  }

  if (app.isPackaged) {
    console.warn("[native-minimal-island] packaged native binary not found")
    return null
  }

  const sourcePath = resolveSwiftSourcePath()
  if (!sourcePath) {
    console.warn("[native-minimal-island] swift source not found")
    return null
  }

  return compileNativeIsland(sourcePath)
}

function handleNativeIslandMessage(message: unknown): void {
  if (
    !message ||
    typeof message !== "object" ||
    !("type" in message) ||
    message.type !== "action" ||
    !("action" in message)
  ) {
    return
  }

  const action = message.action
  if (
    action !== "openLauncher" &&
    action !== "openMainWindow" &&
    action !== "openSettings" &&
    action !== "quit"
  ) {
    return
  }

  nativeIslandActionHandlers?.[action]()
}

function consumeNativeIslandStdout(chunk: Buffer): void {
  nativeIslandStdoutBuffer += chunk.toString("utf8")
  const lines = nativeIslandStdoutBuffer.split("\n")
  nativeIslandStdoutBuffer = lines.pop() ?? ""

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) {
      continue
    }

    try {
      handleNativeIslandMessage(JSON.parse(trimmed) as unknown)
    } catch (error) {
      console.warn("[native-minimal-island] failed to parse message", error)
    }
  }
}

export function startNativeMinimalIsland(handlers: NativeMinimalIslandActionHandlers): void {
  nativeIslandActionHandlers = handlers

  if (process.platform !== "darwin" || nativeIslandProcess) {
    return
  }

  try {
    const binaryPath = ensureNativeIslandBinary()
    if (!binaryPath) {
      return
    }

    const child = spawn(binaryPath, [], {
      env: {
        ...process.env,
        JINGLE_PARENT_PID: String(process.pid)
      },
      stdio: ["pipe", "pipe", "ignore"]
    })

    child.stdout?.on("data", consumeNativeIslandStdout)

    child.on("exit", () => {
      if (nativeIslandProcess === child) {
        nativeIslandProcess = null
        nativeIslandStdoutBuffer = ""
      }
    })

    child.on("error", (error) => {
      console.warn("[native-minimal-island] process failed", error)
      if (nativeIslandProcess === child) {
        nativeIslandProcess = null
        nativeIslandStdoutBuffer = ""
      }
    })

    nativeIslandProcess = child
    setNativeMinimalIslandState("idle")
  } catch (error) {
    console.warn("[native-minimal-island] failed to start", error)
  }
}

export function setNativeMinimalIslandState(state: NativeMinimalIslandState): void {
  if (!nativeIslandProcess?.stdin || nativeIslandProcess.stdin.destroyed) {
    return
  }

  try {
    nativeIslandProcess.stdin.write(JSON.stringify({ type: "setState", state }) + "\n")
  } catch (error) {
    console.warn("[native-minimal-island] failed to write state", error)
  }
}

export function stopNativeMinimalIsland(): void {
  if (!nativeIslandProcess) {
    return
  }

  const child = nativeIslandProcess
  nativeIslandProcess = null
  nativeIslandStdoutBuffer = ""
  nativeIslandActionHandlers = null

  let didExit = false
  child.once("exit", () => {
    didExit = true
  })

  if (child.stdin && !child.stdin.destroyed) {
    child.stdin.end(JSON.stringify({ type: "quit" }) + "\n")
  }

  child.kill("SIGTERM")

  const killTimer = setTimeout(() => {
    if (!didExit) {
      child.kill("SIGKILL")
    }
  }, 500)
  killTimer.unref()
}
