import { spawn } from "node:child_process"
import { readdirSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const requestedArguments = process.argv.slice(2)
const testArguments =
  requestedArguments.length > 0
    ? requestedArguments
    : readdirSync(resolve(repoRoot, "tests/node"))
        .filter((fileName) => fileName.endsWith(".test.ts"))
        .sort()
        .map((fileName) => resolve(repoRoot, "tests/node", fileName))
const requiredVmExecArgv = ["--experimental-vm-modules"]

const child = spawn(
  process.execPath,
  [...requiredVmExecArgv, "--import", "tsx", "--test", ...testArguments],
  {
    cwd: repoRoot,
    env: {
      ...process.env,
      TSX_TSCONFIG_PATH: resolve(repoRoot, "tests/node/tsconfig.json")
    },
    stdio: "inherit"
  }
)

const forwardedSignals = ["SIGHUP", "SIGINT", "SIGTERM"]
const signalListeners = new Map()
for (const signal of forwardedSignals) {
  const listener = () => child.kill(signal)
  signalListeners.set(signal, listener)
  process.once(signal, listener)
}

child.once("error", (error) => {
  removeSignalListeners()
  throw error
})

child.once("exit", (code, signal) => {
  removeSignalListeners()
  if (signal) {
    process.kill(process.pid, signal)
    return
  }
  process.exitCode = code ?? 1
})

function removeSignalListeners() {
  for (const [signal, listener] of signalListeners) {
    process.removeListener(signal, listener)
  }
}
