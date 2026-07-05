import { execFileSync, spawn, type ChildProcess } from "node:child_process"
import { existsSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { app } from "electron"
import type { LauncherSelectionCapturePayload } from "@shared/launcher-selection"

export interface NativeSelectionCaptureHandlers {
  activateSelection: (payload: LauncherSelectionCapturePayload) => void
}

let nativeSelectionProcess: ChildProcess | null = null
let nativeSelectionStdoutBuffer = ""
let nativeSelectionHandlers: NativeSelectionCaptureHandlers | null = null

function resolvePackagedUnpackedPath(candidatePath: string): string {
  if (!app.isPackaged || !candidatePath.includes("app.asar")) {
    return candidatePath
  }

  const unpackedPath = candidatePath.replace("app.asar", "app.asar.unpacked")
  return existsSync(unpackedPath) ? unpackedPath : candidatePath
}

function resolveSelectionCaptureBinaryPath(): string | null {
  const candidates = [
    join(app.getAppPath(), "out/native/jingle-selection-capture"),
    join(process.cwd(), "out/native/jingle-selection-capture"),
    join(__dirname, "..", "native", "jingle-selection-capture")
  ].map(resolvePackagedUnpackedPath)

  return candidates.find((candidate) => existsSync(candidate)) ?? null
}

function resolveSwiftSourcePath(): string | null {
  const candidates = [
    join(app.getAppPath(), "src/native/jingle-selection-capture.swift"),
    join(process.cwd(), "src/native/jingle-selection-capture.swift"),
    join(__dirname, "..", "..", "src", "native", "jingle-selection-capture.swift"),
    join(app.getAppPath(), "out/native/jingle-selection-capture.swift"),
    join(process.cwd(), "out/native/jingle-selection-capture.swift"),
    join(__dirname, "..", "native", "jingle-selection-capture.swift")
  ]

  return candidates.find((candidate) => existsSync(candidate)) ?? null
}

function compileSelectionCapture(sourcePath: string): string {
  const nativeDir = join(app.getPath("userData"), "native")
  const binaryPath = join(nativeDir, "jingle-selection-capture")

  mkdirSync(nativeDir, { recursive: true })
  execFileSync("swiftc", [
    "-parse-as-library",
    "-O",
    sourcePath,
    "-o",
    binaryPath,
    "-framework",
    "AppKit",
    "-framework",
    "ApplicationServices"
  ])

  return binaryPath
}

function ensureSelectionCaptureBinary(): string | null {
  const binaryPath = resolveSelectionCaptureBinaryPath()
  if (binaryPath) {
    return binaryPath
  }

  if (app.isPackaged) {
    console.warn("[native-selection-capture] packaged native binary not found")
    return null
  }

  const sourcePath = resolveSwiftSourcePath()
  if (!sourcePath) {
    console.warn("[native-selection-capture] swift source not found")
    return null
  }

  return compileSelectionCapture(sourcePath)
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function handleSelectionCaptureMessage(message: unknown): void {
  if (!message || typeof message !== "object") {
    return
  }

  const record = message as {
    anchor?: { x?: unknown; y?: unknown }
    sourceApplicationName?: unknown
    sourceBundleId?: unknown
    text?: unknown
    type?: unknown
  }
  if (record.type !== "selectionActivated") {
    return
  }

  const text = readString(record.text)
  const x = readNumber(record.anchor?.x)
  const y = readNumber(record.anchor?.y)
  const sourceApplicationName = readString(record.sourceApplicationName)
  const sourceBundleId = readString(record.sourceBundleId)
  if (!text || x === null || y === null) {
    return
  }

  nativeSelectionHandlers?.activateSelection({
    anchor: { x, y },
    ...(sourceApplicationName ? { sourceApplicationName } : {}),
    ...(sourceBundleId ? { sourceBundleId } : {}),
    text
  })
}

function consumeSelectionCaptureStdout(chunk: Buffer): void {
  nativeSelectionStdoutBuffer += chunk.toString("utf8")
  const lines = nativeSelectionStdoutBuffer.split("\n")
  nativeSelectionStdoutBuffer = lines.pop() ?? ""

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) {
      continue
    }

    try {
      handleSelectionCaptureMessage(JSON.parse(trimmed) as unknown)
    } catch (error) {
      console.warn("[native-selection-capture] failed to parse message", error)
    }
  }
}

export function startNativeSelectionCapture(handlers: NativeSelectionCaptureHandlers): void {
  nativeSelectionHandlers = handlers

  if (process.platform !== "darwin" || nativeSelectionProcess) {
    return
  }

  try {
    const binaryPath = ensureSelectionCaptureBinary()
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

    child.stdout?.on("data", consumeSelectionCaptureStdout)

    child.on("exit", () => {
      if (nativeSelectionProcess === child) {
        nativeSelectionProcess = null
        nativeSelectionStdoutBuffer = ""
      }
    })

    child.on("error", (error) => {
      console.warn("[native-selection-capture] process failed", error)
      if (nativeSelectionProcess === child) {
        nativeSelectionProcess = null
        nativeSelectionStdoutBuffer = ""
      }
    })

    nativeSelectionProcess = child
  } catch (error) {
    console.warn("[native-selection-capture] failed to start", error)
  }
}

export function stopNativeSelectionCapture(): void {
  nativeSelectionHandlers = null

  if (!nativeSelectionProcess) {
    return
  }

  const child = nativeSelectionProcess
  nativeSelectionProcess = null
  nativeSelectionStdoutBuffer = ""

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
