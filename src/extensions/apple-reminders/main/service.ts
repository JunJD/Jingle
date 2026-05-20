import { execFile, execFileSync } from "node:child_process"
import { existsSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { promisify } from "node:util"
import { app } from "electron"
import type { IpcErrorCode } from "@shared/ipc-error"
import { defineNativeExtensionService } from "../../../main/services/native-extensions/sdk"
import type {
  AppleReminder,
  AppleRemindersData,
  CreateAppleReminderRequest,
  DeleteAppleReminderRequest,
  SetAppleReminderCompletedRequest,
  ShowAppleReminderRequest
} from "../src/contracts"
import {
  APPLE_REMINDERS_EXTENSION_ID,
  APPLE_REMINDERS_RPC_METHOD_CREATE_REMINDER,
  APPLE_REMINDERS_RPC_METHOD_DELETE_REMINDER,
  APPLE_REMINDERS_RPC_METHOD_GET_DATA,
  APPLE_REMINDERS_RPC_METHOD_SET_REMINDER_COMPLETED,
  APPLE_REMINDERS_RPC_METHOD_SHOW_REMINDER
} from "../src/contracts"

const execFileAsync = promisify(execFile)
const APPLE_REMINDERS_COMMAND_TIMEOUT_MS = 10_000
const APPLE_REMINDERS_HELPER_NAME = "openwork-apple-reminders"
const APPLE_REMINDERS_HELPER_INFO_PLIST_NAME = "openwork-apple-reminders-info.plist"

interface AppleRemindersHelperRequest {
  method: string
  payload: unknown
}

interface AppleRemindersExecError extends NodeJS.ErrnoException {
  killed?: boolean
  signal?: NodeJS.Signals | null
  stderr?: string
  stdout?: string
}

export class AppleRemindersRequestError extends Error {
  readonly code: IpcErrorCode

  constructor(message: string, code: IpcErrorCode = "UNAVAILABLE") {
    super(message)
    this.name = "AppleRemindersRequestError"
    this.code = code
  }
}

export function isAppleRemindersRequestError(error: unknown): error is AppleRemindersRequestError {
  return error instanceof AppleRemindersRequestError
}

function assertAppleRemindersAvailable(): void {
  if (process.platform !== "darwin") {
    throw new AppleRemindersRequestError("Apple Reminders is only available on macOS.")
  }
}

function resolvePackagedUnpackedPath(candidatePath: string): string {
  if (!app.isPackaged || !candidatePath.includes("app.asar")) {
    return candidatePath
  }

  const unpackedPath = candidatePath.replace("app.asar", "app.asar.unpacked")
  return existsSync(unpackedPath) ? unpackedPath : candidatePath
}

function resolveAppleRemindersBinaryPath(): string | null {
  const candidates = [
    join(app.getAppPath(), "out/native", APPLE_REMINDERS_HELPER_NAME),
    join(process.cwd(), "out/native", APPLE_REMINDERS_HELPER_NAME),
    join(__dirname, "..", "native", APPLE_REMINDERS_HELPER_NAME)
  ].map(resolvePackagedUnpackedPath)

  return candidates.find((candidate) => existsSync(candidate)) ?? null
}

function resolveAppleRemindersSwiftSourcePath(): string | null {
  const candidates = [
    join(app.getAppPath(), "src/native/openwork-apple-reminders.swift"),
    join(process.cwd(), "src/native/openwork-apple-reminders.swift"),
    join(__dirname, "..", "..", "src", "native", "openwork-apple-reminders.swift"),
    join(app.getAppPath(), "out/native/openwork-apple-reminders.swift"),
    join(process.cwd(), "out/native/openwork-apple-reminders.swift"),
    join(__dirname, "..", "native", "openwork-apple-reminders.swift")
  ]

  return candidates.find((candidate) => existsSync(candidate)) ?? null
}

function resolveAppleRemindersInfoPlistPath(): string | null {
  const candidates = [
    join(app.getAppPath(), "src/native", APPLE_REMINDERS_HELPER_INFO_PLIST_NAME),
    join(process.cwd(), "src/native", APPLE_REMINDERS_HELPER_INFO_PLIST_NAME),
    join(__dirname, "..", "..", "src", "native", APPLE_REMINDERS_HELPER_INFO_PLIST_NAME),
    join(app.getAppPath(), "out/native", APPLE_REMINDERS_HELPER_INFO_PLIST_NAME),
    join(process.cwd(), "out/native", APPLE_REMINDERS_HELPER_INFO_PLIST_NAME),
    join(__dirname, "..", "native", APPLE_REMINDERS_HELPER_INFO_PLIST_NAME)
  ]

  return candidates.find((candidate) => existsSync(candidate)) ?? null
}

function compileAppleRemindersBinary(sourcePath: string): string {
  const nativeDir = join(app.getPath("userData"), "native")
  const binaryPath = join(nativeDir, APPLE_REMINDERS_HELPER_NAME)
  const infoPlistPath = resolveAppleRemindersInfoPlistPath()

  mkdirSync(nativeDir, { recursive: true })
  execFileSync("swiftc", [
    "-parse-as-library",
    "-O",
    sourcePath,
    "-o",
    binaryPath,
    ...(infoPlistPath
      ? ["-Xlinker", "-sectcreate", "-Xlinker", "__TEXT", "-Xlinker", "__info_plist", "-Xlinker", infoPlistPath]
      : []),
    "-framework",
    "EventKit",
    "-framework",
    "AppKit"
  ])

  return binaryPath
}

function ensureAppleRemindersBinary(): string {
  const binaryPath = resolveAppleRemindersBinaryPath()
  if (binaryPath) {
    return binaryPath
  }

  if (app.isPackaged) {
    throw new AppleRemindersRequestError("Packaged Apple Reminders helper not found.")
  }

  const sourcePath = resolveAppleRemindersSwiftSourcePath()
  if (!sourcePath) {
    throw new AppleRemindersRequestError("Apple Reminders Swift helper source not found.")
  }

  return compileAppleRemindersBinary(sourcePath)
}

function getAppleRemindersDiagnostic(error: unknown): string {
  const execError = error as AppleRemindersExecError
  const stderr = typeof execError.stderr === "string" ? execError.stderr.trim() : ""
  const stdout = typeof execError.stdout === "string" ? execError.stdout.trim() : ""
  if (stderr || stdout) {
    return stderr || stdout
  }

  if (error instanceof Error) {
    return error.message.trim()
  }

  if (typeof error === "string") {
    return error
  }

  return JSON.stringify(error)
}

export function normalizeAppleRemindersError(error: unknown): AppleRemindersRequestError {
  if (isAppleRemindersRequestError(error)) {
    return error
  }

  const execError = error as AppleRemindersExecError
  const message = getAppleRemindersDiagnostic(error)

  if (execError.code === "ETIMEDOUT" || execError.killed === true || message.includes("timed out")) {
    return new AppleRemindersRequestError(
      "Timed out while talking to Reminders. Grant Reminders access if macOS is showing a permission prompt, then try again."
    )
  }

  if (
    message.includes("OpenworkRemindersAccessDenied") ||
    message.includes("not authorized") ||
    message.includes("not authorised") ||
    message.includes("authorization denied")
  ) {
    return new AppleRemindersRequestError(
      "Openwork needs permission to access Reminders. Grant Reminders access in System Settings and try again.",
      "PERMISSION_DENIED"
    )
  }

  if (message.includes("OpenworkReminderNotFound")) {
    return new AppleRemindersRequestError("Apple Reminders could not find that reminder.", "NOT_FOUND")
  }

  if (message.includes("OpenworkReminderListNotFound")) {
    return new AppleRemindersRequestError(
      "Apple Reminders could not find the target reminder list.",
      "NOT_FOUND"
    )
  }

  if (message.includes("OpenworkUnsupportedMethod")) {
    return new AppleRemindersRequestError(
      "Openwork could not complete the Reminders request. Restart Openwork and try again."
    )
  }

  if (!message) {
    return new AppleRemindersRequestError(
      "Apple Reminders command failed. Open Reminders once, then try again."
    )
  }

  return new AppleRemindersRequestError(`Apple Reminders command failed: ${message}`)
}

async function invokeAppleReminders<TResult>(method: string, payload: unknown): Promise<TResult> {
  assertAppleRemindersAvailable()

  const binaryPath = ensureAppleRemindersBinary()
  const request: AppleRemindersHelperRequest = {
    method,
    payload
  }

  try {
    const { stdout } = await execFileAsync(binaryPath, [JSON.stringify(request)], {
      maxBuffer: 1024 * 1024 * 4,
      timeout: APPLE_REMINDERS_COMMAND_TIMEOUT_MS
    })

    return JSON.parse(stdout.trim() || "null") as TResult
  } catch (error) {
    throw normalizeAppleRemindersError(error)
  }
}

export async function getAppleRemindersData(): Promise<AppleRemindersData> {
  return invokeAppleReminders<AppleRemindersData>(APPLE_REMINDERS_RPC_METHOD_GET_DATA, {})
}

export async function createAppleReminder(
  payload: CreateAppleReminderRequest
): Promise<AppleReminder> {
  return invokeAppleReminders<AppleReminder>(APPLE_REMINDERS_RPC_METHOD_CREATE_REMINDER, payload)
}

export async function setAppleReminderCompleted(
  payload: SetAppleReminderCompletedRequest
): Promise<AppleReminder> {
  return invokeAppleReminders<AppleReminder>(
    APPLE_REMINDERS_RPC_METHOD_SET_REMINDER_COMPLETED,
    payload
  )
}

export async function deleteAppleReminder(
  payload: DeleteAppleReminderRequest
): Promise<{ reminderId: string }> {
  return invokeAppleReminders<{ reminderId: string }>(
    APPLE_REMINDERS_RPC_METHOD_DELETE_REMINDER,
    payload
  )
}

export async function showAppleReminder(payload: ShowAppleReminderRequest): Promise<null> {
  return invokeAppleReminders<null>(APPLE_REMINDERS_RPC_METHOD_SHOW_REMINDER, payload)
}

const appleRemindersNativeExtensionService = defineNativeExtensionService(
  APPLE_REMINDERS_EXTENSION_ID,
  {
    [APPLE_REMINDERS_RPC_METHOD_CREATE_REMINDER]: createAppleReminder,
    [APPLE_REMINDERS_RPC_METHOD_DELETE_REMINDER]: deleteAppleReminder,
    [APPLE_REMINDERS_RPC_METHOD_GET_DATA]: getAppleRemindersData,
    [APPLE_REMINDERS_RPC_METHOD_SET_REMINDER_COMPLETED]: setAppleReminderCompleted,
    [APPLE_REMINDERS_RPC_METHOD_SHOW_REMINDER]: showAppleReminder
  }
)

export default appleRemindersNativeExtensionService
