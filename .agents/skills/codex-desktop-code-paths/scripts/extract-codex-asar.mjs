#!/usr/bin/env node
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs"
import { join, resolve } from "node:path"
import { spawnSync } from "node:child_process"

function readArgs(argv) {
  const args = new Map()
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === "--force") {
      args.set("force", "true")
      continue
    }
    if (value.startsWith("--")) {
      args.set(value.slice(2), argv[index + 1])
      index += 1
    }
  }
  return args
}

function isNonEmptyDirectory(path) {
  return existsSync(path) && readdirSync(path).length > 0
}

function isSafeGeneratedOutput(path) {
  const resolved = resolve(path)
  return resolved.startsWith("/tmp/") || resolved.startsWith("/private/tmp/")
}

const args = readArgs(process.argv.slice(2))
const app = args.get("app") ?? "/Applications/Codex.app"
const out = resolve(args.get("out") ?? "/tmp/codex-app-asar")
const force = args.get("force") === "true"
const asarPath = app.endsWith(".asar") ? app : join(app, "Contents", "Resources", "app.asar")
const asarCli = resolve(process.cwd(), "node_modules", "@electron", "asar", "bin", "asar.js")

if (!existsSync(asarPath)) {
  throw new Error(`Codex app.asar not found: ${asarPath}`)
}

if (!existsSync(asarCli)) {
  throw new Error(
    `@electron/asar CLI not found at ${asarCli}. Run this from the Openwork repo after installing dependencies.`
  )
}

if (isNonEmptyDirectory(out)) {
  if (!force) {
    throw new Error(
      `Output directory is not empty: ${out}. Pass --force to replace a temp extraction.`
    )
  }
  if (!isSafeGeneratedOutput(out)) {
    throw new Error(`Refusing to remove non-temp output directory: ${out}`)
  }
  rmSync(out, { force: true, recursive: true })
}

mkdirSync(out, { recursive: true })

const result = spawnSync(process.execPath, [asarCli, "extract", asarPath, out], {
  stdio: "inherit"
})

if (result.status !== 0) {
  throw new Error(`asar extract failed with status ${result.status ?? "unknown"}`)
}

console.log(`Extracted ${asarPath}`)
console.log(`Output: ${out}`)
console.log(
  `Next: node .agents/skills/codex-desktop-code-paths/scripts/search-codex-bundle.mjs --root ${out} --query "mention|workspace-file|read_thread"`
)
