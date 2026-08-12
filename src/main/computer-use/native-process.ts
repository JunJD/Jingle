import {
  spawn,
  type ChildProcessWithoutNullStreams,
  type SpawnOptionsWithoutStdio
} from "node:child_process"
import {
  COMPUTER_USE_PROCESS_SIGNALS,
  type ComputerUseBackendEnvironment,
  type ComputerUseBackendFailure,
  type ComputerUseProcessSignal,
  type JingleComputerUseNativeBridge,
  type JingleComputerUseNativeRequest
} from "@jingle/computer-use-core"

const DEFAULT_TIMEOUT_MS = 30_000
const TERMINATION_GRACE_MS = 100
const TERMINATION_CONFIRMATION_TIMEOUT_MS = 2_000
const MAX_REQUEST_BYTES = 40 * 1024 * 1024
const MAX_STDOUT_BYTES = 40 * 1024 * 1024
const MAX_STDERR_BYTES = 64 * 1024
const NATIVE_DIAGNOSTIC_CODES = new Set([
  "accessibility_permission_required",
  "invalid_request",
  "native_failed",
  "refused",
  "stale_target",
  "target_unavailable",
  "unavailable",
  "unknown"
])

export interface ComputerUseNativeInvocation {
  args: readonly string[]
  command: string
}

export interface CreateComputerUseNativeProcessBridgeInput {
  environment: ComputerUseBackendEnvironment
  invocation: ComputerUseNativeInvocation
  spawnProcess?: typeof spawnComputerUseProcess
  timeoutMs?: number
}

interface ComputerUseNativeProcessEvidence {
  exitCode?: number
  processSignal?: ComputerUseProcessSignal
  terminationConfirmation?: Promise<void>
}

export class ComputerUseNativeProcessError extends Error implements ComputerUseBackendFailure {
  readonly exitCode: number | undefined
  readonly processSignal: ComputerUseProcessSignal | undefined
  readonly successorObservationSafe: boolean
  readonly terminationConfirmation: Promise<void> | undefined

  constructor(
    message: string,
    readonly code:
      | "helper_failed"
      | "helper_termination_unconfirmed"
      | "invalid_response"
      | "permission_required"
      | "request_too_large"
      | "response_too_large"
      | "timeout"
      | "transport_failed",
    readonly nativeCode: string | null = null,
    evidence: ComputerUseNativeProcessEvidence = {}
  ) {
    super(message)
    this.name = "ComputerUseNativeProcessError"
    this.exitCode = evidence.exitCode
    this.processSignal = evidence.processSignal
    this.successorObservationSafe = code !== "helper_termination_unconfirmed"
    this.terminationConfirmation = evidence.terminationConfirmation
  }
}

export function createComputerUseNativeProcessBridge(
  input: CreateComputerUseNativeProcessBridgeInput
): JingleComputerUseNativeBridge {
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 120_000) {
    throw new Error("Computer-use native timeout must be between 1 and 120 seconds.")
  }
  const spawnProcess = input.spawnProcess ?? spawnComputerUseProcess

  return {
    async invoke(request, signal) {
      signal?.throwIfAborted()
      assertRequestEnvironment(input.environment, request)
      const frame = Buffer.from(JSON.stringify(request), "utf8")
      if (frame.byteLength > MAX_REQUEST_BYTES) {
        throw new ComputerUseNativeProcessError(
          "Computer-use native request exceeds the bounded transport frame.",
          "request_too_large"
        )
      }
      return invokeComputerUseProcess({
        frame,
        invocation: input.invocation,
        signal,
        spawnProcess,
        timeoutMs
      })
    }
  }
}

export function resolveComputerUseBackendEnvironment(
  platform: NodeJS.Platform,
  environment: NodeJS.ProcessEnv
): ComputerUseBackendEnvironment | null {
  if (platform === "darwin") return "macos-quartz"
  if (platform === "win32") return "windows-win32"
  if (platform !== "linux") return null
  if (!environment.WAYLAND_DISPLAY) return "linux-x11"
  const desktop = (
    environment.XDG_CURRENT_DESKTOP ??
    environment.DESKTOP_SESSION ??
    ""
  ).toLowerCase()
  if (desktop.includes("gnome")) return "linux-wayland-gnome"
  if (desktop.includes("kde") || desktop.includes("plasma")) return "linux-wayland-kde"
  return "linux-wayland-other"
}

export function createComputerUseNativeInvocation(
  environment: ComputerUseBackendEnvironment,
  artifactPath: string
): ComputerUseNativeInvocation {
  if (!artifactPath.trim()) throw new Error("Computer-use native artifact path is required.")
  if (environment === "windows-win32") {
    return Object.freeze({
      args: Object.freeze([
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        artifactPath
      ]),
      command: "powershell.exe"
    })
  }
  if (environment.startsWith("linux-")) {
    return Object.freeze({ args: Object.freeze([artifactPath]), command: "/usr/bin/python3" })
  }
  return Object.freeze({ args: Object.freeze([]), command: artifactPath })
}

function assertRequestEnvironment(
  environment: ComputerUseBackendEnvironment,
  request: JingleComputerUseNativeRequest
): void {
  if (request.method === "dispose_session") return
  if (request.environment !== environment) {
    throw new Error("Computer-use native request belongs to another environment.")
  }
}

function spawnComputerUseProcess(
  invocation: ComputerUseNativeInvocation
): ChildProcessWithoutNullStreams {
  return spawn(invocation.command, [...invocation.args], createComputerUseNativeSpawnOptions())
}

export function createComputerUseNativeSpawnOptions(): SpawnOptionsWithoutStdio {
  return {
    env: {
      ...process.env,
      // This is a process-ownership fact, not caller configuration. Always
      // overwrite inherited input so a helper cannot bind to another PID.
      JINGLE_PARENT_PID: String(process.pid)
    },
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true
  }
}

async function invokeComputerUseProcess(input: {
  frame: Buffer
  invocation: ComputerUseNativeInvocation
  signal?: AbortSignal
  spawnProcess: typeof spawnComputerUseProcess
  timeoutMs: number
}): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let child: ChildProcessWithoutNullStreams
    try {
      child = input.spawnProcess(input.invocation)
    } catch {
      reject(
        new ComputerUseNativeProcessError(
          "Computer-use native helper could not be started.",
          "transport_failed"
        )
      )
      return
    }

    let settled = false
    let stdoutBytes = 0
    let stderrBytes = 0
    let termination: { error: unknown } | null = null
    let forceKillTimeout: ReturnType<typeof setTimeout> | undefined
    let terminationConfirmationTimeout: ReturnType<typeof setTimeout> | undefined
    let resolveTerminationConfirmation!: () => void
    let terminationConfirmed = false
    const terminationConfirmation = new Promise<void>((resolve) => {
      resolveTerminationConfirmation = resolve
    })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    const finish = (callback: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      if (forceKillTimeout) clearTimeout(forceKillTimeout)
      if (terminationConfirmationTimeout) clearTimeout(terminationConfirmationTimeout)
      input.signal?.removeEventListener("abort", abort)
      callback()
    }
    const fail = (error: unknown): void => {
      finish(() => reject(error))
    }
    const confirmTermination = (): void => {
      if (terminationConfirmed) return
      terminationConfirmed = true
      resolveTerminationConfirmation()
    }
    const terminate = (error: unknown): void => {
      if (settled || termination) return
      termination = { error }
      try {
        child.kill()
      } catch {
        // The forced termination below remains the authoritative cleanup path.
      }
      forceKillTimeout = setTimeout(() => {
        if (settled) return
        try {
          child.kill("SIGKILL")
        } catch {
          // The confirmation watchdog below remains authoritative.
        }
      }, TERMINATION_GRACE_MS)
      terminationConfirmationTimeout = setTimeout(() => {
        fail(
          new ComputerUseNativeProcessError(
            "Computer-use native helper termination could not be confirmed.",
            "helper_termination_unconfirmed",
            null,
            { terminationConfirmation }
          )
        )
      }, TERMINATION_CONFIRMATION_TIMEOUT_MS)
    }
    const abort = (): void => {
      terminate(
        input.signal?.reason ?? new DOMException("Computer use was cancelled.", "AbortError")
      )
    }
    const timeout = setTimeout(() => {
      terminate(
        new ComputerUseNativeProcessError("Computer-use native helper timed out.", "timeout")
      )
    }, input.timeoutMs)

    input.signal?.addEventListener("abort", abort, { once: true })
    if (input.signal?.aborted) {
      abort()
      return
    }
    child.on("error", () => {
      if (termination) return
      fail(
        new ComputerUseNativeProcessError(
          "Computer-use native helper transport failed.",
          "transport_failed"
        )
      )
    })
    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.byteLength
      if (stdoutBytes > MAX_STDOUT_BYTES) {
        terminate(
          new ComputerUseNativeProcessError(
            "Computer-use native response exceeds the bounded transport frame.",
            "response_too_large"
          )
        )
        return
      }
      stdout.push(chunk)
    })
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderrBytes >= MAX_STDERR_BYTES) return
      const remaining = MAX_STDERR_BYTES - stderrBytes
      const bounded = chunk.subarray(0, remaining)
      stderrBytes += bounded.byteLength
      stderr.push(bounded)
    })
    child.on("close", (code, processSignal) => {
      if (termination) confirmTermination()
      if (settled) return
      if (termination) {
        fail(termination.error)
        return
      }
      if (code !== 0 || processSignal) {
        const nativeCode = readNativeDiagnosticCode(Buffer.concat(stderr, stderrBytes))
        const permissionRequired = nativeCode === "accessibility_permission_required"
        fail(
          new ComputerUseNativeProcessError(
            permissionRequired
              ? "Computer Use requires macOS Accessibility permission. Enable Jingle in System Settings > Privacy & Security > Accessibility, then try again."
              : nativeCode
                ? `Computer-use native helper failed with diagnostic code ${nativeCode}.`
                : "Computer-use native helper returned a failed terminal status.",
            permissionRequired ? "permission_required" : "helper_failed",
            nativeCode,
            readNativeProcessEvidence(code, processSignal)
          )
        )
        return
      }
      const raw = Buffer.concat(stdout, stdoutBytes).toString("utf8").trim()
      if (!raw || raw.includes("\n")) {
        fail(
          new ComputerUseNativeProcessError(
            "Computer-use native helper returned an invalid response frame.",
            "invalid_response"
          )
        )
        return
      }
      try {
        const parsed = JSON.parse(raw) as unknown
        finish(() => resolve(parsed))
      } catch {
        fail(
          new ComputerUseNativeProcessError(
            "Computer-use native helper returned invalid JSON.",
            "invalid_response"
          )
        )
      }
    })

    child.stdin.on("error", () => {
      terminate(
        new ComputerUseNativeProcessError(
          "Computer-use native helper rejected its request frame.",
          "transport_failed"
        )
      )
    })
    child.stdin.end(input.frame)
  })
}

function readNativeProcessEvidence(
  exitCode: number | null,
  processSignal: NodeJS.Signals | null
): ComputerUseNativeProcessEvidence {
  return {
    ...(Number.isSafeInteger(exitCode) && exitCode! >= 0 && exitCode! <= 0x7fffffff
      ? { exitCode: exitCode! }
      : {}),
    ...(processSignal &&
    COMPUTER_USE_PROCESS_SIGNALS.includes(processSignal as ComputerUseProcessSignal)
      ? { processSignal: processSignal as ComputerUseProcessSignal }
      : {})
  }
}

function readNativeDiagnosticCode(stderr: Buffer): string | null {
  const frame = stderr.toString("utf8").trim()
  if (!frame || frame.includes("\n")) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(frame) as unknown
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null
  const record = parsed as Record<string, unknown>
  if (!Object.keys(record).every((key) => ["code", "details", "message"].includes(key))) {
    return null
  }
  return typeof record.code === "string" && NATIVE_DIAGNOSTIC_CODES.has(record.code)
    ? record.code
    : null
}
