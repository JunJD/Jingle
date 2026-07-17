#!/usr/bin/env node

import fs from "node:fs"
import path from "node:path"
import { createRequire } from "node:module"
import { spawnSync } from "node:child_process"
import { fileURLToPath, pathToFileURL } from "node:url"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const commitlintPackage = path.join(repoRoot, "node_modules", "@commitlint", "cli", "package.json")
let commitlintPromise

export function isMergeSubject(message) {
  return /^Merge\b/.test(message.split(/\r?\n/, 1)[0] ?? "")
}

export function shouldSkipCommitlint({ message, mergeInProgress = false, parentCount = 0 }) {
  return isMergeSubject(message) && (mergeInProgress || parentCount >= 2)
}

function runGit(repository, args) {
  const result = spawnSync("git", ["-C", repository, ...args], {
    encoding: "utf8"
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `git ${args.join(" ")} failed`)
  }
  return result.stdout.trim()
}

function getCommitFacts(repository, commit) {
  const parentLine = runGit(repository, ["rev-list", "--parents", "-n", "1", commit])
  const parentCount = Math.max(0, parentLine.split(/\s+/).length - 1)
  const message = `${runGit(repository, ["show", "-s", "--format=%B", commit])}\n`
  return { commit, message, parentCount }
}

function hasMergeInProgress(repository) {
  const gitPath = runGit(repository, ["rev-parse", "--git-path", "MERGE_HEAD"])
  const mergeHeadPath = path.isAbsolute(gitPath) ? gitPath : path.resolve(repository, gitPath)
  return fs.existsSync(mergeHeadPath)
}

async function loadCommitlint() {
  if (!commitlintPromise) {
    commitlintPromise = (async () => {
      if (!fs.existsSync(commitlintPackage)) {
        throw new Error(
          "Jingle commit message check could not start because commitlint is not installed.\n" +
            "Run `pnpm install` from the repository root and retry."
        )
      }
      const require = createRequire(commitlintPackage)
      const [{ default: lint }, { default: load }] = await Promise.all([
        import(pathToFileURL(require.resolve("@commitlint/lint")).href),
        import(pathToFileURL(require.resolve("@commitlint/load")).href)
      ])
      const config = await load({}, { cwd: repoRoot })
      return { config, lint }
    })()
  }
  return commitlintPromise
}

async function lintMessage(message, label) {
  const { config, lint } = await loadCommitlint()
  const result = await lint(message, config.rules, {
    defaultIgnores: config.defaultIgnores,
    ignores: config.ignores,
    parserOpts: config.parserPreset?.parserOpts,
    plugins: config.plugins
  })

  if (label) process.stdout.write(`Checking commit message ${label}\n`)
  process.stdout.write(`⧗ input: ${message.split(/\r?\n/, 1)[0] ?? ""}\n`)
  for (const problem of [...result.errors, ...result.warnings]) {
    process.stdout.write(`✖ ${problem.message} [${problem.name}]\n`)
  }
  if (result.valid) {
    process.stdout.write("✔ found 0 problems, 0 warnings\n")
  } else {
    process.stdout.write(
      `✖ found ${result.errors.length} problems, ${result.warnings.length} warnings\n` +
        `ⓘ Get help: ${config.helpUrl}\n`
    )
  }
  return result.valid ? 0 : 1
}

async function validateMessage(facts) {
  if (shouldSkipCommitlint(facts)) {
    const source = facts.mergeInProgress ? "MERGE_HEAD" : `${facts.parentCount} parents`
    process.stdout.write(`Skipping generated merge subject (${source})\n`)
    return 0
  }
  return lintMessage(facts.message, facts.commit ? `for ${facts.commit}` : "")
}

function parseArguments(argv) {
  const options = { repository: process.cwd() }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (!["--commit", "--edit", "--from", "--repository", "--to"].includes(argument)) {
      if (argument === "--last") {
        options.last = true
        continue
      }
      throw new Error(`Unknown argument: ${argument}`)
    }
    const value = argv[index + 1]
    if (!value) throw new Error(`Missing value for ${argument}`)
    options[argument.slice(2)] = value
    index += 1
  }
  return options
}

function readStdin() {
  return fs.readFileSync(0, "utf8")
}

export async function main(argv) {
  const options = parseArguments(argv)
  const repository = path.resolve(options.repository)

  if (options.edit) {
    return await validateMessage({
      mergeInProgress: hasMergeInProgress(repository),
      message: fs.readFileSync(options.edit, "utf8"),
      parentCount: 0
    })
  }

  if (options.from || options.to) {
    if (!options.from || !options.to) throw new Error("--from and --to must be provided together")
    const commits = runGit(repository, [
      "rev-list",
      "--reverse",
      "--topo-order",
      `${options.from}..${options.to}`
    ])
      .split(/\s+/)
      .filter(Boolean)
    let status = 0
    for (const commit of commits) {
      if ((await validateMessage(getCommitFacts(repository, commit))) !== 0) status = 1
    }
    return status
  }

  const commit = options.commit ?? (options.last ? "HEAD" : undefined)
  if (commit) return await validateMessage(getCommitFacts(repository, commit))

  return await validateMessage({ message: readStdin(), parentCount: 0 })
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = await main(process.argv.slice(2))
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
