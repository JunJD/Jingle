import { execFile, spawn, type ChildProcess, type ExecException } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { promisify } from "node:util"
import { app } from "electron"
import { defineNativeExtensionService } from "@jingle/extension-api"
import type { CoffeePreferences, CoffeeStartRequest, CoffeeStatus } from "../contracts"
import { COFFEE_EXTENSION_ID } from "../contracts"

const execFileAsync = promisify(execFile)

const EXIT_CODE_NO_MATCH = 1
const ERROR_CODE_NO_PROCESS = "ESRCH"
const COFFEE_PROCESS_MARKER = "jingle-coffee-caffeinate"

interface CoffeeExecError extends ExecException {
  stderr?: string
  stdout?: string
}

interface CoffeeProcessError extends Error {
  code?: string
}

interface CaffeinateProcessInfo {
  args: string
  elapsedSeconds: number
}

interface OwnedCoffeeProcess {
  pid: number
}

let ownedCoffeeProcess: OwnedCoffeeProcess | null = null

function getOwnedCoffeeProcessPath(): string {
  return join(app.getPath("userData"), "extension-state", COFFEE_EXTENSION_ID, "caffeinate.pid")
}

function readOwnedCoffeeProcessRecord(): OwnedCoffeeProcess | null {
  if (ownedCoffeeProcess) {
    return ownedCoffeeProcess
  }

  const processPath = getOwnedCoffeeProcessPath()
  if (!existsSync(processPath)) {
    return null
  }

  const pidText = readFileSync(processPath, "utf8").trim()
  if (!/^\d+$/.test(pidText)) {
    rmSync(processPath, { force: true })
    return null
  }

  ownedCoffeeProcess = {
    pid: Number.parseInt(pidText, 10)
  }
  return ownedCoffeeProcess
}

function writeOwnedCoffeeProcess(processInfo: OwnedCoffeeProcess): void {
  const processPath = getOwnedCoffeeProcessPath()
  mkdirSync(dirname(processPath), { recursive: true })
  writeFileSync(processPath, String(processInfo.pid), "utf8")
  ownedCoffeeProcess = processInfo
}

function clearOwnedCoffeeProcess(pid: number): void {
  if (ownedCoffeeProcess?.pid === pid) {
    ownedCoffeeProcess = null
  }
  const processPath = getOwnedCoffeeProcessPath()
  if (!existsSync(processPath)) {
    return
  }

  const pidText = readFileSync(processPath, "utf8").trim()
  if (pidText === String(pid)) {
    rmSync(processPath, { force: true })
  }
}

function cleanupStartedCoffeeProcess(pid: number): void {
  try {
    process.kill(pid, "SIGTERM")
  } catch (error) {
    const processError = error as CoffeeProcessError
    if (processError.code !== ERROR_CODE_NO_PROCESS) {
      console.warn(
        `[Coffee] Failed to clean up caffeinate process ${pid}. ${getCoffeeDiagnostic(error)}`
      )
    }
  }

  try {
    clearOwnedCoffeeProcess(pid)
  } catch (error) {
    console.warn(
      `[Coffee] Failed to clear caffeinate process record ${pid}. ${getCoffeeDiagnostic(error)}`
    )
  }
}

function assertCoffeeAvailable(): void {
  if (process.platform !== "darwin") {
    throw new Error("Coffee is only available on macOS.")
  }
}

function normalizePreferences(preferences: Record<string, unknown>): Required<CoffeePreferences> {
  return {
    icon: isCoffeeIconSet(preferences.icon) ? preferences.icon : "pot",
    preventDisk: preferences.preventDisk !== false,
    preventDisplay: preferences.preventDisplay !== false,
    preventSystem: preferences.preventSystem !== false
  }
}

function isCoffeeIconSet(value: unknown): value is Required<CoffeePreferences>["icon"] {
  return value === "cup" || value === "mug" || value === "paper-cup" || value === "pot"
}

function buildCaffeinateArgs(input: {
  durationSeconds?: number
  preferences: Required<CoffeePreferences>
}): string[] {
  const flags = [
    input.preferences.preventDisplay ? "d" : "",
    input.preferences.preventDisk ? "m" : "",
    input.preferences.preventSystem ? "i" : ""
  ].join("")
  const args = ["-u"]

  if (flags) {
    args.push(`-${flags}`)
  }
  if (input.durationSeconds !== undefined) {
    args.push("-t", String(Math.ceil(input.durationSeconds)))
  }

  return args
}

function normalizeDurationSeconds(value: unknown): number | undefined {
  if (value === undefined) {
    return undefined
  }
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error("Coffee durationSeconds must be a positive number.")
  }

  return Math.ceil(value)
}

export function formatCoffeeDuration(seconds: number): string {
  const units = [
    { label: "d", value: 86_400 },
    { label: "h", value: 3_600 },
    { label: "m", value: 60 },
    { label: "s", value: 1 }
  ]
  const parts: string[] = []
  let remaining = Math.max(0, Math.floor(seconds))

  for (const unit of units) {
    const amount = Math.floor(remaining / unit.value)
    remaining %= unit.value
    if (amount > 0) {
      parts.push(`${amount}${unit.label}`)
    }
  }

  return parts.join(" ") || "0s"
}

function parseElapsedTime(value: string): number {
  const parts = value.split(":").reverse()
  const seconds = Number.parseInt(parts[0] ?? "", 10) || 0
  const minutes = Number.parseInt(parts[1] ?? "", 10) || 0
  let hours = 0
  let days = 0

  if (parts[2]) {
    const dayHour = parts[2].split("-")
    if (dayHour.length === 2) {
      days = Number.parseInt(dayHour[0] ?? "", 10) || 0
      hours = Number.parseInt(dayHour[1] ?? "", 10) || 0
    } else {
      hours = Number.parseInt(parts[2], 10) || 0
    }
  }

  return seconds + minutes * 60 + hours * 3_600 + days * 86_400
}

function parseCaffeinateProcessInfo(output: string): CaffeinateProcessInfo | null {
  const lines = output
    .trim()
    .split("\n")
    .flatMap((line) => {
      const trimmed = line.trim()
      return trimmed ? [trimmed] : []
    })
  const latest = lines.at(-1)
  if (!latest) {
    return null
  }

  const [elapsed, ...args] = latest.split(/\s+/)
  if (!elapsed) {
    return null
  }

  return {
    args: args.join(" "),
    elapsedSeconds: parseElapsedTime(elapsed)
  }
}

function isCaffeinateProcessInfo(info: CaffeinateProcessInfo): boolean {
  return info.args.split(/\s+/)[0] === COFFEE_PROCESS_MARKER
}

function toCoffeeStatus(info: CaffeinateProcessInfo | null): CoffeeStatus {
  if (!info) {
    return {
      isRunning: false,
      secondsRemaining: null,
      timeRemaining: null
    }
  }

  const timeoutMatch = info.args.match(/(?:^|\s)-t\s+(\d+)(?:\s|$)/)
  if (!timeoutMatch) {
    return {
      isRunning: true,
      secondsRemaining: null,
      timeRemaining: null
    }
  }

  const timeoutSeconds = Number.parseInt(timeoutMatch[1] ?? "", 10)
  const secondsRemaining = Math.max(0, timeoutSeconds - info.elapsedSeconds)
  return {
    isRunning: secondsRemaining > 0,
    secondsRemaining,
    timeRemaining: secondsRemaining > 0 ? `${formatCoffeeDuration(secondsRemaining)} remain` : null
  }
}

function getCoffeeDiagnostic(error: unknown): string {
  const execError = error as CoffeeExecError
  const stderr = typeof execError.stderr === "string" ? execError.stderr.trim() : ""
  const stdout = typeof execError.stdout === "string" ? execError.stdout.trim() : ""
  if (stderr || stdout) {
    return stderr || stdout
  }
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}

async function readOwnedCaffeinateProcess(): Promise<{
  info: CaffeinateProcessInfo
  pid: number
} | null> {
  const processInfo = readOwnedCoffeeProcessRecord()
  if (!processInfo) {
    return null
  }

  try {
    const { stdout } = await execFileAsync("/bin/ps", [
      "-o",
      "etime,args=",
      "-p",
      String(processInfo.pid)
    ])
    const info = parseCaffeinateProcessInfo(stdout)
    if (!info || !isCaffeinateProcessInfo(info)) {
      clearOwnedCoffeeProcess(processInfo.pid)
      return null
    }

    return {
      info,
      pid: processInfo.pid
    }
  } catch (error) {
    const execError = error as CoffeeExecError
    if (execError.code === EXIT_CODE_NO_MATCH) {
      clearOwnedCoffeeProcess(processInfo.pid)
      return null
    }
    throw new Error(`Failed to read caffeinate status. ${getCoffeeDiagnostic(error)}`)
  }
}

export async function getCoffeeStatus(): Promise<CoffeeStatus> {
  if (process.platform !== "darwin") {
    return {
      isRunning: false,
      secondsRemaining: null,
      timeRemaining: null
    }
  }

  const ownedProcess = await readOwnedCaffeinateProcess()
  return toCoffeeStatus(ownedProcess?.info ?? null)
}

export async function stopCoffee(): Promise<CoffeeStatus> {
  assertCoffeeAvailable()
  const ownedProcess = await readOwnedCaffeinateProcess()
  if (!ownedProcess) {
    return toCoffeeStatus(null)
  }

  try {
    process.kill(ownedProcess.pid, "SIGTERM")
  } catch (error) {
    const processError = error as CoffeeProcessError
    if (processError.code !== ERROR_CODE_NO_PROCESS) {
      throw new Error(`Failed to stop caffeinate. ${getCoffeeDiagnostic(error)}`)
    }
  }

  clearOwnedCoffeeProcess(ownedProcess.pid)
  return toCoffeeStatus(null)
}

export async function startCoffee(input: {
  durationSeconds?: number
  preferences: CoffeePreferences
}): Promise<CoffeeStatus> {
  assertCoffeeAvailable()
  await stopCoffee()

  const caffeinateArgs = buildCaffeinateArgs({
    durationSeconds: input.durationSeconds,
    preferences: normalizePreferences({ ...input.preferences })
  })
  const child: ChildProcess = spawn("/usr/bin/caffeinate", caffeinateArgs, {
    argv0: COFFEE_PROCESS_MARKER,
    detached: true,
    stdio: "ignore"
  })
  if (child.pid === undefined) {
    throw new Error("Failed to start caffeinate.")
  }
  const pid = child.pid
  child.once("exit", () => clearOwnedCoffeeProcess(pid))
  child.once("error", () => clearOwnedCoffeeProcess(pid))

  try {
    writeOwnedCoffeeProcess({ pid })
  } catch (error) {
    cleanupStartedCoffeeProcess(pid)
    throw error
  }

  child.unref()

  return getCoffeeStatus()
}

export async function toggleCoffee(input: {
  preferences: CoffeePreferences
}): Promise<CoffeeStatus> {
  const status = await getCoffeeStatus()
  if (status.isRunning) {
    return stopCoffee()
  }

  return startCoffee({ preferences: input.preferences })
}

export const coffeeNativeExtensionService = defineNativeExtensionService(COFFEE_EXTENSION_ID, {
  "get-status": () => getCoffeeStatus(),
  start: (payload: CoffeeStartRequest, context) =>
    startCoffee({
      durationSeconds: normalizeDurationSeconds(payload.durationSeconds),
      preferences: context.extensionPreferences
    }),
  stop: () => stopCoffee(),
  toggle: (_payload: Record<string, never>, context) =>
    toggleCoffee({
      preferences: context.extensionPreferences
    })
})

export default coffeeNativeExtensionService
