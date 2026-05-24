import { fileURLToPath } from "node:url"
import { loadEnv } from "vite"
import { runLocalCommand } from "./lib/run-local-command.mjs"

const DOTENV_PREFIXES = ["LANGSMITH_"]

function printUsageAndExit() {
  console.error("Usage: node scripts/run-with-dotenv.mjs <mode> -- <command> [args ...]")
  process.exit(1)
}

async function main() {
  const separatorIndex = process.argv.indexOf("--")
  if (separatorIndex !== 3) {
    printUsageAndExit()
  }

  const mode = process.argv[2]
  const commandAndArgs = process.argv.slice(separatorIndex + 1)
  if (!mode || commandAndArgs.length === 0) {
    printUsageAndExit()
  }

  const [command, ...args] = commandAndArgs
  const env = createDotenvCommandEnv(mode, process.env)

  await runLocalCommand(command, args, { env })
}

export function createDotenvCommandEnv(mode, env) {
  return {
    ...loadEnv(mode, process.cwd(), DOTENV_PREFIXES),
    ...env
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
