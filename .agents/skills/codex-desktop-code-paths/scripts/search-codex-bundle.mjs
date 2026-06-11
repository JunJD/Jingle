#!/usr/bin/env node
import { existsSync } from "node:fs"
import { resolve } from "node:path"
import { spawnSync } from "node:child_process"

function readArgs(argv) {
  const args = { queries: [] }
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === "--detail") {
      args.detail = true
      continue
    }
    if (value === "--root") {
      args.root = argv[index + 1]
      index += 1
      continue
    }
    if (value === "--query") {
      args.queries.push(argv[index + 1])
      index += 1
      continue
    }
    if (value === "--max-count") {
      args.maxCount = argv[index + 1]
      index += 1
    }
  }
  return args
}

const args = readArgs(process.argv.slice(2))
const root = resolve(args.root ?? "/tmp/codex-app-asar")
const queries =
  args.queries.length > 0
    ? args.queries
    : [
        "workspace-file|atMention|insertAtMention|createFuzzyFileSearchSession",
        "read_thread|thread/goal|thread_dynamic_tools|split-items"
      ]

if (!existsSync(root)) {
  throw new Error(`Extracted Codex bundle not found: ${root}`)
}

const rgCheck = spawnSync("rg", ["--version"], { encoding: "utf8" })
if (rgCheck.status !== 0) {
  throw new Error("ripgrep (`rg`) is required for bundle search.")
}

for (const query of queries) {
  console.log(`\n## ${query}\n`)
  const rgArgs = args.detail
    ? [
        "-n",
        "-i",
        "-S",
        "--max-columns",
        "240",
        "--max-columns-preview",
        "--glob",
        "!**/*.map",
        "--glob",
        "!**/assets/[a-z][a-z]-*.js",
        "--glob",
        "!**/node_modules/**",
        "--max-count",
        args.maxCount ?? "20",
        query,
        root
      ]
    : [
        "-i",
        "-S",
        "--files-with-matches",
        "--glob",
        "!**/*.map",
        "--glob",
        "!**/assets/[a-z][a-z]-*.js",
        "--glob",
        "!**/node_modules/**",
        query,
        root
      ]
  const result = spawnSync("rg", rgArgs, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 })

  if (result.error) {
    throw result.error
  }
  if (result.stdout) {
    process.stdout.write(result.stdout)
  }
  if (result.stderr) {
    process.stderr.write(result.stderr)
  }
  if (result.status !== 0 && result.status !== 1) {
    throw new Error(`rg failed for query: ${query}`)
  }
  if (result.status === 1) {
    console.log("(no matches)")
  }
}
