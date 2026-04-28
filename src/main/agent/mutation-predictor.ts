import { existsSync } from "node:fs"
import path from "node:path"
import { performance } from "node:perf_hooks"
import { Worker } from "node:worker_threads"
import type { MutationPrediction, MutationPredictionChange } from "@shared/mutation-prediction"

const DEFAULT_TIMEOUT_MS = 2_500
const WORKER_FILENAME = "mutation-predictor-worker.mjs"

export interface MutationPredictor {
  predictExecute(command: string): Promise<MutationPrediction>
}

export interface JustBashMutationPredictorOptions {
  workspacePath: string
  timeoutMs?: number
  workerPath?: string
}

function normalizeWorkspaceMountPoint(workspacePath: string): string | null {
  if (process.platform === "win32") {
    return null
  }

  return path.resolve(workspacePath).split(path.sep).join("/")
}

function trimStderr(stderr: string): string | null {
  const trimmed = stderr.trim()
  return trimmed.length > 0 ? trimmed : null
}

interface ShellExecResult {
  exitCode: number
  stderr: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function buildPrediction(params: {
  command: string
  status: MutationPrediction["status"]
  changes?: MutationPredictionChange[]
  durationMs: number
  result?: ShellExecResult
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

function readWorkerPrediction(message: unknown): MutationPrediction | null {
  if (!isRecord(message) || message.type !== "prediction" || !isRecord(message.prediction)) {
    return null
  }

  return message.prediction as unknown as MutationPrediction
}

function messageFromError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function resolveMutationPredictorWorkerPath(): string {
  const candidates = [
    path.join(__dirname, WORKER_FILENAME),
    path.resolve(process.cwd(), "out/main", WORKER_FILENAME)
  ]

  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0]
}

export class JustBashMutationPredictor implements MutationPredictor {
  private readonly mountPoint: string | null
  private readonly timeoutMs: number
  private readonly workerPath: string
  private readonly workspacePath: string

  constructor(options: JustBashMutationPredictorOptions) {
    this.workspacePath = path.resolve(options.workspacePath)
    this.mountPoint = normalizeWorkspaceMountPoint(this.workspacePath)
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.workerPath = options.workerPath ?? resolveMutationPredictorWorkerPath()
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

    if (!existsSync(this.workerPath)) {
      return buildPrediction({
        command,
        status: "simulation_error",
        durationMs: performance.now() - startedAt,
        summary: `Simulation worker is unavailable at ${this.workerPath}; target files are unknown.`
      })
    }

    return this.runWorker(command, startedAt)
  }

  private runWorker(command: string, startedAt: number): Promise<MutationPrediction> {
    return new Promise((resolve) => {
      let settled = false
      let timeoutId: ReturnType<typeof setTimeout> | null = null
      let worker: Worker

      try {
        worker = new Worker(this.workerPath, {
          execArgv: ["--no-warnings"],
          workerData: {
            command,
            mountPoint: this.mountPoint,
            timeoutMs: this.timeoutMs,
            workspacePath: this.workspacePath
          }
        })
      } catch (error) {
        resolve(
          buildPrediction({
            command,
            status: "simulation_error",
            durationMs: performance.now() - startedAt,
            summary: `Simulation worker failed to start: ${messageFromError(error)}; target files are unknown.`
          })
        )
        return
      }

      const finish = (prediction: MutationPrediction): void => {
        if (settled) {
          return
        }

        settled = true
        if (timeoutId) {
          clearTimeout(timeoutId)
        }
        void worker.terminate()
        resolve(prediction)
      }

      const fail = (summary: string, status: MutationPrediction["status"] = "simulation_error") => {
        finish(
          buildPrediction({
            command,
            status,
            durationMs: performance.now() - startedAt,
            summary
          })
        )
      }

      timeoutId = setTimeout(() => {
        fail(
          `Simulation worker timed out after ${this.timeoutMs}ms; target files are unknown.`,
          "timed_out"
        )
      }, this.timeoutMs)

      worker.once("message", (message) => {
        const prediction = readWorkerPrediction(message)
        if (prediction) {
          finish(prediction)
          return
        }

        fail("Simulation worker returned an invalid response; target files are unknown.")
      })

      worker.once("error", (error) => {
        fail(`Simulation worker failed: ${messageFromError(error)}; target files are unknown.`)
      })

      worker.once("exit", (code) => {
        if (!settled) {
          fail(`Simulation worker exited with code ${code}; target files are unknown.`)
        }
      })
    })
  }
}
