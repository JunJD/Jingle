import { appendFileSync, existsSync, mkdirSync, unlinkSync } from "node:fs"
import { dirname, isAbsolute, join, resolve } from "node:path"
import { app, crashReporter } from "electron"

const JINGLE_HOME_ENV = "JINGLE_HOME"
const BOOTSTRAP_FILE_NAME = "release-smoke-bootstrap.jsonl"
const BOOTSTRAP_ARGUMENT = "--jingle-release-smoke-bootstrap="
const QUIT_REQUEST_FILE_NAME = "release-smoke-quit"
const USER_DATA_ARGUMENT = "--user-data-dir="

function readArgument(prefix: string): string | null {
  const matches = process.argv.filter((argument) => argument.startsWith(prefix))
  if (matches.length !== 1) return null
  const value = matches[0].slice(prefix.length)
  return value.length > 0 ? value : null
}

const userDataPath = readArgument(USER_DATA_ARGUMENT)
const declaredBootstrapPath = readArgument(BOOTSTRAP_ARGUMENT)
const expectedJingleHome =
  userDataPath && isAbsolute(userDataPath) ? dirname(resolve(userDataPath)) : null
const bootstrapPath =
  expectedJingleHome && declaredBootstrapPath && isAbsolute(declaredBootstrapPath)
    ? resolve(declaredBootstrapPath) === join(expectedJingleHome, BOOTSTRAP_FILE_NAME)
      ? resolve(declaredBootstrapPath)
      : null
    : null
const quitRequestPath =
  bootstrapPath && expectedJingleHome ? join(expectedJingleHome, QUIT_REQUEST_FILE_NAME) : null

function describeBootstrapError(error: unknown): {
  message: string
  name: string
  stack: string | null
} {
  const resolved = error instanceof Error ? error : new Error(String(error))
  return {
    message: resolved.message.slice(0, 4096),
    name: resolved.name.slice(0, 128),
    stack: resolved.stack?.slice(0, 16_384) ?? null
  }
}

function recordReleaseSmokeBootstrapStage(stage: string, error?: unknown): void {
  if (!bootstrapPath || !expectedJingleHome) return
  const environmentJingleHome = process.env[JINGLE_HOME_ENV]?.trim()
  try {
    mkdirSync(expectedJingleHome, { recursive: true })
    appendFileSync(
      bootstrapPath,
      `${JSON.stringify({
        ...(error === undefined ? {} : { error: describeBootstrapError(error) }),
        environmentJingleHome:
          environmentJingleHome === undefined
            ? "missing"
            : resolve(environmentJingleHome) === expectedJingleHome
              ? "matching"
              : "mismatch",
        pid: process.pid,
        stage,
        timestamp: new Date().toISOString()
      })}\n`,
      { encoding: "utf8", mode: 0o600 }
    )
  } catch {
    // The application bootstrap must not depend on optional release-smoke diagnostics.
  }
}

function startReleaseSmokeQuitOwner(): void {
  if (!quitRequestPath) return
  const timer = setInterval(() => {
    if (!existsSync(quitRequestPath)) return
    try {
      unlinkSync(quitRequestPath)
      recordReleaseSmokeBootstrapStage("quit_requested")
      app.quit()
    } catch (error) {
      clearInterval(timer)
      recordReleaseSmokeBootstrapStage("quit_request_failed", error)
      setImmediate(() => {
        throw error instanceof Error ? error : new Error(String(error))
      })
    }
  }, 50)
  timer.unref()
  app.once("before-quit", () => clearInterval(timer))
  recordReleaseSmokeBootstrapStage("quit_owner_started")
}

recordReleaseSmokeBootstrapStage("bootstrap_started")

if (bootstrapPath && expectedJingleHome) {
  try {
    const crashDumpsPath = join(expectedJingleHome, "crash-dumps")
    mkdirSync(crashDumpsPath, { recursive: true })
    app.setPath("crashDumps", crashDumpsPath)
    crashReporter.start({
      productName: "Jingle release smoke",
      uploadToServer: false
    })
    recordReleaseSmokeBootstrapStage("crash_reporter_started")
  } catch (error) {
    recordReleaseSmokeBootstrapStage("crash_reporter_failed", error)
    throw error
  }
}

void import("./index")
  .then(() => {
    recordReleaseSmokeBootstrapStage("application_imported")
    startReleaseSmokeQuitOwner()
    if (bootstrapPath && expectedJingleHome) {
      void import("./release-smoke-probe-owner")
        .then(({ startReleaseSmokeProbeOwner }) => {
          startReleaseSmokeProbeOwner(expectedJingleHome, recordReleaseSmokeBootstrapStage)
        })
        .catch((error: unknown) => {
          recordReleaseSmokeBootstrapStage("probe_owner_failed", error)
          setImmediate(() => {
            throw error instanceof Error ? error : new Error(String(error))
          })
        })
    }
  })
  .catch((error: unknown) => {
    recordReleaseSmokeBootstrapStage("application_import_failed", error)
    console.error("[MainBootstrap] Application import failed:", error)
    setImmediate(() => {
      throw error instanceof Error ? error : new Error(String(error))
    })
  })
