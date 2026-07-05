import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { delimiter, resolve } from "node:path"

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

  return new Promise((resolvePromise, reject) => {
    const child = spawn(executable, args, {
      cwd,
      env,
      shell: needsShell,
      stdio: "inherit"
    })

    child.on("error", reject)
    child.on("close", (code, signal) => {
      if (code === 0) {
        resolvePromise()
        return
      }

      const outcome = signal ? `signal ${signal}` : `code ${code ?? "unknown"}`
      reject(new Error(`${command} ${args.join(" ")} exited with ${outcome}`))
    })
  })
}
