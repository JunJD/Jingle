import { execFile, execFileSync } from "node:child_process"
import { existsSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { promisify } from "node:util"
import { app } from "electron"
import type {
  DesktopAutomationRunner,
  NativeDesktopAutomationRequest,
  NativeDesktopAutomationResponse
} from "./desktop-automation"

const execFileAsync = promisify(execFile)

export const DESKTOP_AUTOMATION_COMMAND_TIMEOUT_MS = 15_000

interface DesktopAutomationExecError extends NodeJS.ErrnoException {
  killed?: boolean
  signal?: string | null
  stderr?: string
}

function resolvePackagedUnpackedPath(candidatePath: string): string {
  if (!app.isPackaged || !candidatePath.includes("app.asar")) {
    return candidatePath
  }

  const unpackedPath = candidatePath.replace("app.asar", "app.asar.unpacked")
  return existsSync(unpackedPath) ? unpackedPath : candidatePath
}

function resolveDesktopAutomationBinaryPath(): string | null {
  const candidates = [
    join(app.getAppPath(), "out/native/jingle-desktop-automation"),
    join(process.cwd(), "out/native/jingle-desktop-automation"),
    join(__dirname, "..", "native", "jingle-desktop-automation")
  ].map(resolvePackagedUnpackedPath)

  return candidates.find((candidate) => existsSync(candidate)) ?? null
}

function resolveDesktopAutomationSwiftSourcePath(): string | null {
  const candidates = [
    join(app.getAppPath(), "src/native/jingle-desktop-automation.swift"),
    join(process.cwd(), "src/native/jingle-desktop-automation.swift"),
    join(__dirname, "..", "..", "src", "native", "jingle-desktop-automation.swift"),
    join(app.getAppPath(), "out/native/jingle-desktop-automation.swift"),
    join(process.cwd(), "out/native/jingle-desktop-automation.swift"),
    join(__dirname, "..", "native", "jingle-desktop-automation.swift")
  ]

  return candidates.find((candidate) => existsSync(candidate)) ?? null
}

function compileDesktopAutomationBinary(sourcePath: string): string {
  const nativeDir = join(app.getPath("userData"), "native")
  const binaryPath = join(nativeDir, "jingle-desktop-automation")

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

function ensureDesktopAutomationBinary(): string {
  const binaryPath = resolveDesktopAutomationBinaryPath()
  if (binaryPath) {
    return binaryPath
  }

  if (app.isPackaged) {
    throw new Error("Packaged desktop automation binary not found.")
  }

  const sourcePath = resolveDesktopAutomationSwiftSourcePath()
  if (!sourcePath) {
    throw new Error("Desktop automation Swift source not found.")
  }

  return compileDesktopAutomationBinary(sourcePath)
}

export function normalizeDesktopAutomationCommandError(error: unknown): Error {
  const execError = error as DesktopAutomationExecError

  if (execError.code === "ETIMEDOUT" || execError.killed === true) {
    return new Error(
      `Desktop automation command timed out after ${DESKTOP_AUTOMATION_COMMAND_TIMEOUT_MS}ms.`
    )
  }

  if (typeof execError.stderr === "string" && execError.stderr.trim().length > 0) {
    return new Error(execError.stderr.trim())
  }

  return error instanceof Error ? error : new Error("Desktop automation command failed.")
}

function parseDesktopAutomationResponse(stdout: string): NativeDesktopAutomationResponse {
  try {
    return JSON.parse(stdout) as NativeDesktopAutomationResponse
  } catch {
    throw new Error("Desktop automation command returned invalid JSON.")
  }
}

async function runDesktopAutomationRequest(
  request: NativeDesktopAutomationRequest
): Promise<NativeDesktopAutomationResponse> {
  const binaryPath = ensureDesktopAutomationBinary()

  try {
    const result = await execFileAsync(binaryPath, [JSON.stringify(request)], {
      timeout: DESKTOP_AUTOMATION_COMMAND_TIMEOUT_MS
    })
    return parseDesktopAutomationResponse(result.stdout)
  } catch (error) {
    throw normalizeDesktopAutomationCommandError(error)
  }
}

export function createDesktopAutomationRunner(): DesktopAutomationRunner {
  return {
    platform: process.platform,
    run: runDesktopAutomationRequest
  }
}
