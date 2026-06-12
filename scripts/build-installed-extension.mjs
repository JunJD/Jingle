#!/usr/bin/env node

import { existsSync, readdirSync } from "node:fs"
import { join, resolve } from "node:path"

const inputArgs = process.argv.slice(2)
const { flags, positionals } = splitBuildArgs(inputArgs)
const extensionRefs =
  positionals.length > 0 ? positionals : listInstallableExtensionPackageRefs()

process.argv.splice(2, inputArgs.length, "build", ...extensionRefs, ...flags)
await import("../packages/extension-cli/src/cli.mjs")

function splitBuildArgs(args) {
  const flags = []
  const positionals = []

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === "--out-dir" || arg === "--trust") {
      const value = args[index + 1]
      if (!value) {
        throw new Error(`${arg} requires a value`)
      }
      flags.push(arg, value)
      index += 1
      continue
    }

    positionals.push(arg)
  }

  return { flags, positionals }
}

function listInstallableExtensionPackageRefs() {
  const installableRoot = resolve("installable-extensions")
  if (!existsSync(installableRoot)) {
    return []
  }

  return readdirSync(installableRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .filter((entry) => existsSync(join(installableRoot, entry.name, "package.json")))
    .map((entry) => `installable-extensions/${entry.name}`)
    .sort((left, right) => left.localeCompare(right))
}
