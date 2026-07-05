import path from "node:path"
import { performance } from "node:perf_hooks"
import { parentPort, workerData } from "node:worker_threads"
import { Bash, OverlayFs, type BashExecResult } from "just-bash"
import type { MutationPrediction, MutationPredictionChange } from "@shared/mutation-prediction"
import { loadJustBashJavaScriptRuntimeCommands } from "./just-bash-runtime-compat"
import { RecordingFs } from "./recording-fs"

const IGNORED_PATH_SEGMENTS = new Set([".git"])

interface MutationPredictorWorkerRequest {
  command: string
  cwd: string
  mountPoint: string
  timeoutMs: number
  workspacePath: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function trimStderr(stderr: string): string | null {
  const trimmed = stderr.trim()
  return trimmed.length > 0 ? trimmed : null
}

function shouldTrackPath(filePath: string, mountPoint: string): boolean {
  const relativePath = path.posix.relative(mountPoint, filePath)
  if (relativePath.startsWith("..")) {
    return false
  }

  if (!relativePath) {
    return true
  }

  return !relativePath.split("/").some((segment) => IGNORED_PATH_SEGMENTS.has(segment))
}

function summarizeChanges(changes: MutationPredictionChange[]): string {
  if (changes.length === 0) {
    return "Predicted no file changes in the tracked workspace."
  }

  const preview = changes
    .slice(0, 3)
    .map((change) => `${change.changeType} ${change.path}`)
    .join(", ")
  const suffix = changes.length > 3 ? `, +${changes.length - 3} more` : ""
  return `Predicted ${changes.length} file change${changes.length === 1 ? "" : "s"}: ${preview}${suffix}.`
}

function isUnsupportedCommand(result: BashExecResult): boolean {
  const stderr = trimStderr(result.stderr)
  return result.exitCode === 127 || Boolean(stderr && /command not found/i.test(stderr))
}

function buildPrediction(params: {
  command: string
  status: MutationPrediction["status"]
  changes?: MutationPredictionChange[]
  durationMs: number
  result?: Pick<BashExecResult, "exitCode" | "stderr">
  summary: string
}): MutationPrediction {
  const { changes = [], command, durationMs, result, status, summary } = params

  return {
    command,
    status,
    confidence: status === "predicted" ? "medium" : status === "command_failed" ? "low" : "none",
    summary,
    changes,
    durationMs: Math.round(durationMs),
    exitCode: result?.exitCode ?? null,
    stderr: trimStderr(result?.stderr ?? "")
  }
}

function messageFromError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function createShell(params: {
  command: string
  cwd: string
  fs: RecordingFs
  timeoutMs: number
}): Promise<Bash> {
  const javascriptRuntime = await loadJustBashJavaScriptRuntimeCommands(params.command)

  return new Bash({
    fs: params.fs,
    cwd: params.cwd,
    python: true,
    javascript: javascriptRuntime.useBuiltInRuntime,
    customCommands: javascriptRuntime.customCommands,
    executionLimits: {
      maxCallDepth: 40,
      maxCommandCount: 2_000,
      maxLoopIterations: 2_000,
      maxAwkIterations: 2_000,
      maxSedIterations: 2_000,
      maxJqIterations: 2_000,
      maxSourceDepth: 20,
      maxSubstitutionDepth: 20,
      maxBraceExpansionResults: 2_000,
      maxGlobOperations: 50_000,
      maxOutputSize: 100_000,
      maxPythonTimeoutMs: params.timeoutMs,
      maxJsTimeoutMs: params.timeoutMs
    }
  })
}

function readRequest(value: unknown): MutationPredictorWorkerRequest {
  if (
    !isRecord(value) ||
    typeof value.command !== "string" ||
    typeof value.cwd !== "string" ||
    typeof value.mountPoint !== "string" ||
    typeof value.timeoutMs !== "number" ||
    typeof value.workspacePath !== "string"
  ) {
    throw new Error("Malformed mutation prediction request.")
  }

  return {
    command: value.command,
    cwd: value.cwd,
    mountPoint: value.mountPoint,
    timeoutMs: value.timeoutMs,
    workspacePath: value.workspacePath
  }
}

async function predictExecute(request: MutationPredictorWorkerRequest): Promise<MutationPrediction> {
  const startedAt = performance.now()
  const overlay = new OverlayFs({
    root: request.workspacePath,
    mountPoint: request.mountPoint
  })
  const recordingFs = new RecordingFs(overlay, {
    shouldTrackPath: (filePath) => shouldTrackPath(filePath, request.mountPoint)
  })
  const shell = await createShell({
    command: request.command,
    cwd: request.cwd,
    fs: recordingFs,
    timeoutMs: request.timeoutMs
  })

  const abortController = new AbortController()
  const timeoutId = setTimeout(() => abortController.abort(), request.timeoutMs)

  try {
    const result = await shell.exec(request.command, {
      signal: abortController.signal
    })
    const changes = await recordingFs.collectChanges()
    const durationMs = performance.now() - startedAt

    if (result.exitCode === 0) {
      return buildPrediction({
        command: request.command,
        status: "predicted",
        changes,
        durationMs,
        result,
        summary: summarizeChanges(changes)
      })
    }

    if (isUnsupportedCommand(result)) {
      return buildPrediction({
        command: request.command,
        status: "unsupported_command",
        changes,
        durationMs,
        result,
        summary:
          changes.length > 0
            ? `Simulator could not fully execute the command, but it touched ${changes.length} tracked file${changes.length === 1 ? "" : "s"} before failing.`
            : "Simulator could not execute this command in just-bash, so target files are unknown."
      })
    }

    return buildPrediction({
      command: request.command,
      status: "command_failed",
      changes,
      durationMs,
      result,
      summary:
        changes.length > 0
          ? `Simulation exited with code ${result.exitCode} after touching ${changes.length} tracked file${changes.length === 1 ? "" : "s"}.`
          : `Simulation exited with code ${result.exitCode}; no tracked file changes were observed.`
    })
  } catch (error) {
    const durationMs = performance.now() - startedAt
    const timedOut =
      abortController.signal.aborted ||
      (error instanceof Error && /abort|aborted|timeout/i.test(error.message))

    return buildPrediction({
      command: request.command,
      status: timedOut ? "timed_out" : "simulation_error",
      durationMs,
      summary: timedOut
        ? `Simulation timed out after ${request.timeoutMs}ms; target files are unknown.`
        : error instanceof Error
          ? `Simulation failed: ${error.message}`
          : "Simulation failed before file targets could be predicted."
    })
  } finally {
    clearTimeout(timeoutId)
  }
}

async function run(): Promise<void> {
  if (!parentPort) {
    throw new Error("Mutation predictor worker requires a parent port.")
  }

  const startedAt = performance.now()
  const command =
    isRecord(workerData) && typeof workerData.command === "string" ? workerData.command : ""

  try {
    const request = readRequest(workerData)
    const prediction = await predictExecute(request)
    parentPort.postMessage({ type: "prediction", prediction })
  } catch (error) {
    parentPort.postMessage({
      type: "prediction",
      prediction: buildPrediction({
        command,
        status: "simulation_error",
        durationMs: performance.now() - startedAt,
        summary: `Simulation worker failed: ${messageFromError(error)}; target files are unknown.`
      })
    })
  }
}

void run()
