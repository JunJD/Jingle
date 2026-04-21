import path from "node:path"
import { performance } from "node:perf_hooks"
import { Bash, OverlayFs, type BashExecResult } from "just-bash"
import type { MutationPrediction, MutationPredictionChange } from "@shared/mutation-prediction"
import { RecordingFs } from "./recording-fs"

const DEFAULT_TIMEOUT_MS = 2_500

// Skip VCS metadata from prediction output.
const IGNORED_PATH_SEGMENTS = new Set([".git"])

export interface MutationPredictor {
  predictExecute(command: string): Promise<MutationPrediction>
}

export interface JustBashMutationPredictorOptions {
  workspacePath: string
  timeoutMs?: number
}

function normalizeWorkspaceMountPoint(workspacePath: string): string | null {
  if (process.platform === "win32") {
    return null
  }

  return path.resolve(workspacePath).split(path.sep).join("/")
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

function trimStderr(stderr: string): string | null {
  const trimmed = stderr.trim()
  return trimmed.length > 0 ? trimmed : null
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

export class JustBashMutationPredictor implements MutationPredictor {
  private readonly mountPoint: string | null
  private readonly timeoutMs: number
  private readonly workspacePath: string

  constructor(options: JustBashMutationPredictorOptions) {
    this.workspacePath = path.resolve(options.workspacePath)
    this.mountPoint = normalizeWorkspaceMountPoint(this.workspacePath)
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  }

  async predictExecute(command: string): Promise<MutationPrediction> {
    const startedAt = performance.now()

    if (!this.mountPoint) {
      return buildPrediction({
        command,
        status: "unsupported_platform",
        durationMs: performance.now() - startedAt,
        summary: "Mutation prediction is currently only enabled for POSIX workspaces."
      })
    }

    const overlay = new OverlayFs({
      root: this.workspacePath,
      mountPoint: this.mountPoint
    })
    const recordingFs = new RecordingFs(overlay, {
      shouldTrackPath: (filePath) => shouldTrackPath(filePath, this.mountPoint!)
    })
    const shell = new Bash({
      fs: recordingFs,
      cwd: this.mountPoint,
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
        maxOutputSize: 100_000
      }
    })

    const abortController = new AbortController()
    const timeoutId = setTimeout(() => abortController.abort(), this.timeoutMs)

    try {
      const result = await shell.exec(command, {
        signal: abortController.signal
      })
      const changes = await recordingFs.collectChanges()
      const durationMs = performance.now() - startedAt

      if (result.exitCode === 0) {
        return buildPrediction({
          command,
          status: "predicted",
          changes,
          durationMs,
          result,
          summary: summarizeChanges(changes)
        })
      }

      if (isUnsupportedCommand(result)) {
        return buildPrediction({
          command,
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
        command,
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
        command,
        status: timedOut ? "timed_out" : "simulation_error",
        durationMs,
        summary: timedOut
          ? `Simulation timed out after ${this.timeoutMs}ms; target files are unknown.`
          : error instanceof Error
            ? `Simulation failed: ${error.message}`
            : "Simulation failed before file targets could be predicted."
      })
    } finally {
      clearTimeout(timeoutId)
    }
  }
}
