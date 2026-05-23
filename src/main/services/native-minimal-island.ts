import { execFileSync, spawn, type ChildProcess } from "node:child_process"
import { existsSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { app } from "electron"

export type NativeMinimalIslandState = "idle" | "working" | "approval"

let nativeIslandProcess: ChildProcess | null = null

function resolvePackagedUnpackedPath(candidatePath: string): string {
  if (!app.isPackaged || !candidatePath.includes("app.asar")) {
    return candidatePath
  }

  const unpackedPath = candidatePath.replace("app.asar", "app.asar.unpacked")
  return existsSync(unpackedPath) ? unpackedPath : candidatePath
}

function resolveNativeIslandBinaryPath(): string | null {
  const candidates = [
    join(app.getAppPath(), "out/native/openwork-minimal-island"),
    join(process.cwd(), "out/native/openwork-minimal-island"),
    join(__dirname, "..", "native", "openwork-minimal-island")
  ].map(resolvePackagedUnpackedPath)

  return candidates.find((candidate) => existsSync(candidate)) ?? null
}

function resolveSwiftSourcePath(): string | null {
  const candidates = [
    join(app.getAppPath(), "src/native/openwork-minimal-island.swift"),
    join(process.cwd(), "src/native/openwork-minimal-island.swift"),
    join(__dirname, "..", "..", "src", "native", "openwork-minimal-island.swift"),
    join(app.getAppPath(), "out/native/openwork-minimal-island.swift"),
    join(process.cwd(), "out/native/openwork-minimal-island.swift"),
    join(__dirname, "..", "native", "openwork-minimal-island.swift")
  ]

  return candidates.find((candidate) => existsSync(candidate)) ?? null
}

function compileNativeIsland(sourcePath: string): string {
  const nativeDir = join(app.getPath("userData"), "native")
  const binaryPath = join(nativeDir, "openwork-minimal-island")

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

export function startNativeMinimalIsland(): void {
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
        OPENWORK_PARENT_PID: String(process.pid)
      },
      stdio: ["pipe", "ignore", "ignore"]
    })

    child.on("exit", () => {
      if (nativeIslandProcess === child) {
        nativeIslandProcess = null
      }
    })

    child.on("error", (error) => {
      console.warn("[native-minimal-island] process failed", error)
      if (nativeIslandProcess === child) {
        nativeIslandProcess = null
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

  nativeIslandProcess.stdin.write(JSON.stringify({ type: "setState", state }) + "\n")
}

export function stopNativeMinimalIsland(): void {
  if (!nativeIslandProcess) {
    return
  }

  const child = nativeIslandProcess
  nativeIslandProcess = null

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
