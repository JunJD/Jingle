import { execFile } from "node:child_process"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)
export const APPLE_SHORTCUTS_COMMAND_TIMEOUT_MS = 15_000

export interface AppleShortcutsRunner {
  platform: NodeJS.Platform
  run: (args: string[]) => Promise<{ stderr: string; stdout: string }>
}

export interface RunAppleShortcutRequest {
  name: string
}

export interface RunAppleShortcutResult {
  name: string
  output: string
}

interface AppleShortcutsExecError extends NodeJS.ErrnoException {
  killed?: boolean
  signal?: string | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

async function runAppleShortcutsCommand(
  args: string[]
): Promise<{ stderr: string; stdout: string }> {
  try {
    const result = await execFileAsync("shortcuts", args, {
      timeout: APPLE_SHORTCUTS_COMMAND_TIMEOUT_MS
    })
    return {
      stderr: result.stderr,
      stdout: result.stdout
    }
  } catch (error) {
    throw normalizeAppleShortcutsCommandError(error)
  }
}

export function normalizeAppleShortcutsCommandError(error: unknown): Error {
  const execError = error as AppleShortcutsExecError
  if (execError.code === "ETIMEDOUT" || execError.killed === true) {
    return new Error(
      `Apple Shortcuts command timed out after ${APPLE_SHORTCUTS_COMMAND_TIMEOUT_MS}ms.`
    )
  }

  return error instanceof Error ? error : new Error("Apple Shortcuts command failed.")
}

function assertAppleShortcutsPlatform(platform: NodeJS.Platform): void {
  if (platform !== "darwin") {
    throw new Error("Apple Shortcuts tools are currently only supported on macOS.")
  }
}

export function parseRunAppleShortcutRequest(input: unknown): RunAppleShortcutRequest {
  if (!isRecord(input) || typeof input.name !== "string" || input.name.trim().length === 0) {
    throw new Error('run_apple_shortcut requires a non-empty "name" string.')
  }

  return {
    name: input.name.trim()
  }
}

export function parseAppleShortcutsList(stdout: string): string[] {
  return stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

export async function listAppleShortcuts(
  runner: AppleShortcutsRunner = {
    platform: process.platform,
    run: runAppleShortcutsCommand
  }
): Promise<string[]> {
  assertAppleShortcutsPlatform(runner.platform)
  const result = await runner.run(["list"])
  return parseAppleShortcutsList(result.stdout)
}

export async function runAppleShortcut(
  request: RunAppleShortcutRequest,
  runner: AppleShortcutsRunner = {
    platform: process.platform,
    run: runAppleShortcutsCommand
  }
): Promise<RunAppleShortcutResult> {
  assertAppleShortcutsPlatform(runner.platform)
  const result = await runner.run(["run", request.name])

  return {
    name: request.name,
    output: result.stdout.trim()
  }
}
