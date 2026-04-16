import { runLocalCommand } from "./lib/run-local-command.mjs"

function printUsageAndExit() {
  console.error(
    "Usage: node scripts/run-with-env.mjs KEY=VALUE [KEY=VALUE ...] -- <command> [args ...]"
  )
  process.exit(1)
}

function parseEnvAssignments(rawAssignments) {
  const env = {}

  for (const assignment of rawAssignments) {
    const separatorIndex = assignment.indexOf("=")
    if (separatorIndex <= 0) {
      throw new Error(`Invalid environment assignment: ${assignment}`)
    }

    const key = assignment.slice(0, separatorIndex)
    const value = assignment.slice(separatorIndex + 1)
    env[key] = value
  }

  return env
}

async function main() {
  const separatorIndex = process.argv.indexOf("--")
  if (separatorIndex === -1) {
    printUsageAndExit()
  }

  const rawAssignments = process.argv.slice(2, separatorIndex)
  const commandAndArgs = process.argv.slice(separatorIndex + 1)

  if (rawAssignments.length === 0 || commandAndArgs.length === 0) {
    printUsageAndExit()
  }

  const [command, ...args] = commandAndArgs
  const env = {
    ...process.env,
    ...parseEnvAssignments(rawAssignments)
  }

  await runLocalCommand(command, args, { env })
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
