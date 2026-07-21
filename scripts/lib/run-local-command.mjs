import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { delimiter, resolve } from "node:path"

export class LocalCommandError extends Error {
  constructor(commandName, failure) {
    const message =
      failure.kind === "spawn-failed"
        ? `${commandName} could not start${failure.systemCode ? ` (${failure.systemCode})` : ""}.`
        : `${commandName} exited with ${failure.signal ? `signal ${failure.signal}` : `code ${failure.exitCode ?? "unknown"}`}.`
    super(message)
    this.name = "LocalCommandError"
    this.commandName = commandName
    this.failure = Object.freeze({ ...failure })
  }
}

function readSystemErrorCode(error) {
  if (!error || typeof error !== "object" || !("code" in error)) return undefined
  const code = error.code
  return typeof code === "string" && /^E[A-Z0-9_]{1,31}$/.test(code) ? code : undefined
}

function readCommandName(options) {
  const commandName = options.displayName?.trim()
  if (!commandName) {
    throw new TypeError("runLocalCommand requires a static displayName.")
  }
  return commandName
}

function getPathKey(env) {
  return Object.keys(env).find((key) => key.toLowerCase() === "path") ?? "PATH"
}

function withLocalBinOnPath(cwd, env) {
  const pathKey = getPathKey(env)
  const localBinDir = resolve(cwd, "node_modules", ".bin")

  if (!existsSync(localBinDir)) {
    return env
  }

  const nextEnv = { ...env }
  const currentPath = nextEnv[pathKey]
  nextEnv[pathKey] = currentPath ? `${localBinDir}${delimiter}${currentPath}` : localBinDir
  return nextEnv
}

function resolveLocalExecutable(cwd, command) {
  if (process.platform !== "win32") {
    return command
  }

  if (command.includes("/") || command.includes("\\") || command.includes(":")) {
    return command
  }

  const localCmd = resolve(cwd, "node_modules", ".bin", `${command}.cmd`)
  return existsSync(localCmd) ? localCmd : command
}

export function runLocalCommand(command, args, options = {}) {
  const cwd = options.cwd ?? process.cwd()
  const env = withLocalBinOnPath(cwd, options.env ?? process.env)
  const executable = resolveLocalExecutable(cwd, command)
  const needsShell = process.platform === "win32" && executable.toLowerCase().endsWith(".cmd")
  const commandName = readCommandName(options)

  return new Promise((resolvePromise, reject) => {
    let child
    try {
      child = spawn(executable, args, {
        cwd,
        env,
        shell: needsShell,
        stdio: "inherit"
      })
    } catch (error) {
      reject(
        new LocalCommandError(commandName, {
          kind: "spawn-failed",
          systemCode: readSystemErrorCode(error)
        })
      )
      return
    }

    child.on("error", (error) => {
      reject(
        new LocalCommandError(commandName, {
          kind: "spawn-failed",
          systemCode: readSystemErrorCode(error)
        })
      )
    })
    child.on("close", (code, signal) => {
      if (code === 0) {
        resolvePromise()
        return
      }

      reject(
        new LocalCommandError(commandName, {
          exitCode: code,
          kind: "exited",
          signal
        })
      )
    })
  })
}
