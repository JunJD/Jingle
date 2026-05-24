import { spawn } from "node:child_process"

const COMPILER_SKIP_PATTERNS = [
  /Compilation Skipped:/,
  /React Compiler has skipped optimizing this component/
]

function npmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm"
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["inherit", "pipe", "pipe"],
      ...options
    })

    let combinedOutput = ""

    const write = (chunk, target) => {
      const text = chunk.toString()
      combinedOutput += text
      target.write(text)
    }

    child.stdout?.on("data", (chunk) => {
      write(chunk, process.stdout)
    })

    child.stderr?.on("data", (chunk) => {
      write(chunk, process.stderr)
    })

    child.on("error", reject)
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`${command} ${args.join(" ")} exited with code ${code ?? "unknown"}`))
        return
      }

      resolve(combinedOutput)
    })
  })
}

async function main() {
  const npm = npmCommand()

  await run(npm, ["run", "typecheck"])
  const buildOutput = await run(npm, ["run", "build:electron"])

  if (COMPILER_SKIP_PATTERNS.some((pattern) => pattern.test(buildOutput))) {
    throw new Error(
      "React Compiler reported skipped optimizations during build. Fix the warning before merging."
    )
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
