#!/usr/bin/env node
import { execFileSync } from "node:child_process"
import {
  cpSync,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync
} from "node:fs"
import { basename, join, resolve } from "node:path"
import { pathToFileURL } from "node:url"

export const KNOWN_EXTENSION_MIGRATION_TARGETS = {
  "apple-reminders": {
    extensionId: "apple-reminders",
    extensionPath: "extensions/apple-reminders",
    title: "Apple Reminders"
  },
  "figma-files": {
    extensionId: "figma-files",
    extensionPath: "extensions/figma-files",
    title: "Figma File Search"
  },
  github: {
    extensionId: "github",
    extensionPath: "extensions/github",
    title: "GitHub"
  },
  notion: {
    extensionId: "notion",
    extensionPath: "extensions/notion",
    title: "Notion"
  }
}

const HOST_ENTRY_MODES = new Set(["shell", "migrated-source"])

export function parseMigrateExtensionArgs(argv) {
  const options = {
    apply: false,
    extensionPath: null,
    gitRef: "HEAD",
    help: false,
    mode: "shell",
    outDir: null,
    raycastRepo: null,
    target: null,
    targetExtensionId: null,
    targetExtensionTitle: null,
    typecheckNode: false,
    verify: false
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === "--apply") {
      options.apply = true
    } else if (arg === "--verify") {
      options.verify = true
    } else if (arg === "--typecheck-node") {
      options.typecheckNode = true
    } else if (arg === "--help" || arg === "-h") {
      options.help = true
    } else if (arg === "--mode") {
      options.mode = readOptionValue(argv, ++index, arg)
    } else if (arg === "--git-ref") {
      options.gitRef = readOptionValue(argv, ++index, arg)
    } else if (arg === "--raycast-repo") {
      options.raycastRepo = readOptionValue(argv, ++index, arg)
    } else if (arg === "--out-dir") {
      options.outDir = readOptionValue(argv, ++index, arg)
    } else if (arg === "--extension-path") {
      options.extensionPath = readOptionValue(argv, ++index, arg)
    } else if (arg === "--target-extension-id") {
      options.targetExtensionId = readOptionValue(argv, ++index, arg)
    } else if (arg === "--target-extension-title") {
      options.targetExtensionTitle = readOptionValue(argv, ++index, arg)
    } else if (!arg.startsWith("--") && options.target === null) {
      options.target = arg
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }

  if (!HOST_ENTRY_MODES.has(options.mode)) {
    throw new Error(`Unknown --mode "${options.mode}". Expected shell or migrated-source.`)
  }

  if (!options.help && !options.target) {
    throw new Error("Missing extension target. Run `npm run migrate:extension -- --help`.")
  }

  return options
}

function readOptionValue(argv, index, flag) {
  const value = argv[index]
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${flag}.`)
  }
  return value
}

export function resolveMigrationRunPlan(options, input = {}) {
  const cwd = input.cwd ? resolve(input.cwd) : process.cwd()
  const env = input.env ?? process.env
  const targetDefaults = KNOWN_EXTENSION_MIGRATION_TARGETS[options.target]
  if (!targetDefaults) {
    throw new Error(
      `Unknown extension target "${options.target}". Known targets: ${Object.keys(
        KNOWN_EXTENSION_MIGRATION_TARGETS
      ).join(", ")}.`
    )
  }

  const extensionId = options.targetExtensionId ?? targetDefaults.extensionId
  const extensionPath = options.extensionPath ?? targetDefaults.extensionPath
  const title = options.targetExtensionTitle ?? targetDefaults.title
  const raycastRepo = resolve(
    cwd,
    options.raycastRepo ?? env.OPENWORK_RAYCAST_EXTENSIONS_REPO ?? "../raycast-extensions-notion"
  )
  const outDir = resolve(
    cwd,
    options.outDir ?? join(".ow-build", "extension-migration", extensionId, options.mode)
  )
  const generatedPackageDir = join(outDir, "openwork-package")
  const destinationDir = resolve(cwd, "extensions", extensionId)
  const ignoredRoot = resolve(cwd, ".ignored-extensions")

  return {
    apply: options.apply,
    cwd,
    destinationDir,
    extensionId,
    extensionPath,
    generatedPackageDir,
    gitRef: options.gitRef,
    ignoredRoot,
    mode: options.mode,
    outDir,
    previewArgs: [
      "scripts/preview-raycast-ai-migration.mjs",
      "--git-repo",
      raycastRepo,
      "--extension-path",
      extensionPath,
      "--git-ref",
      options.gitRef,
      "--out-dir",
      outDir,
      "--target-extension-id",
      extensionId,
      "--target-extension-title",
      title,
      "--host-entry-mode",
      options.mode
    ],
    raycastRepo,
    target: options.target,
    title,
    verify: options.verify,
    verifyCommands: buildVerifyCommands(options)
  }
}

function buildVerifyCommands(options) {
  if (!options.verify) {
    return []
  }

  const commands = [
    ["npm", "run", "check:extensions"],
    ["npm", "run", "check:guardrails"]
  ]
  if (options.typecheckNode) {
    commands.push(["npm", "run", "typecheck:node"])
  }
  return commands
}

export function createIgnoredBackupPath(ignoredRoot, extensionId, now = new Date()) {
  const preferred = join(ignoredRoot, extensionId)
  if (!existsSync(preferred)) {
    return preferred
  }

  const stamp = now
    .toISOString()
    .replace(/\.\d{3}Z$/, "")
    .replaceAll("-", "")
    .replaceAll(":", "")
    .replace("T", "-")
  const base = join(ignoredRoot, `${extensionId}-${stamp}`)
  let candidate = base
  let counter = 2
  while (existsSync(candidate)) {
    candidate = `${base}-${counter}`
    counter += 1
  }
  return candidate
}

export function runMigrateExtensionPlan(plan, io = {}) {
  const stdout = io.stdout ?? process.stdout
  const exec = io.execFileSync ?? execFileSync
  assertSafeOutputDir(plan.cwd, plan.outDir)
  assertSafeShellApply(plan)
  stdout.write(
    `[extension-migration] generating ${plan.extensionId} from ${plan.extensionPath} (${plan.mode})\n`
  )

  rmSync(plan.outDir, { force: true, recursive: true })
  mkdirSync(plan.outDir, { recursive: true })
  exec(process.execPath, plan.previewArgs, {
    cwd: plan.cwd,
    stdio: "inherit"
  })

  if (plan.apply) {
    applyGeneratedPackage(plan, stdout)
  } else {
    stdout.write(
      `[extension-migration] dry-run complete: ${relativeOrBasename(plan.cwd, plan.generatedPackageDir)}\n`
    )
  }

  for (const command of plan.verifyCommands) {
    stdout.write(`[extension-migration] verify: ${command.join(" ")}\n`)
    exec(command[0], command.slice(1), {
      cwd: plan.cwd,
      stdio: "inherit"
    })
  }
}

function assertSafeShellApply(plan) {
  const liveExtensionIds = new Set(
    Object.values(KNOWN_EXTENSION_MIGRATION_TARGETS).map((target) => target.extensionId)
  )
  if (plan.apply && plan.mode === "shell" && liveExtensionIds.has(plan.extensionId)) {
    throw new Error(
      `Refusing to apply shell migration over live extension "${plan.extensionId}". Use --target-extension-id ${plan.extensionId}-generated for shell previews, or --mode migrated-source for a live replacement.`
    )
  }
}

function applyGeneratedPackage(plan, stdout) {
  if (!existsSync(plan.generatedPackageDir)) {
    throw new Error(`Generated package does not exist: ${plan.generatedPackageDir}`)
  }

  mkdirSync(plan.ignoredRoot, { recursive: true })
  if (existsSync(plan.destinationDir)) {
    const backupDir = createIgnoredBackupPath(plan.ignoredRoot, plan.extensionId)
    renameSync(plan.destinationDir, backupDir)
    stdout.write(
      `[extension-migration] moved previous ${plan.extensionId} to ${relativeOrBasename(
        plan.cwd,
        backupDir
      )}\n`
    )
  }

  cpSync(plan.generatedPackageDir, plan.destinationDir, { recursive: true })
  stdout.write(
    `[extension-migration] applied package to ${relativeOrBasename(plan.cwd, plan.destinationDir)}\n`
  )
}

function assertSafeOutputDir(cwd, outDir) {
  const normalizedCwd = resolve(cwd)
  const normalizedOutDir = resolve(outDir)
  const allowedBuildRoot = resolve(cwd, ".ow-build", "extension-migration")
  const isInsideAllowedBuildRoot =
    normalizedOutDir === allowedBuildRoot ||
    normalizedOutDir.startsWith(`${allowedBuildRoot}/`)

  if (!isInsideAllowedBuildRoot) {
    throw new Error(`Refusing to clear unsafe output directory: ${normalizedOutDir}`)
  }
}

function relativeOrBasename(cwd, absolutePath) {
  return absolutePath.startsWith(`${cwd}/`) ? absolutePath.slice(cwd.length + 1) : basename(absolutePath)
}

export function formatUsage() {
  return [
    "Usage:",
    "  npm run migrate:extension -- <target> [--mode shell|migrated-source] [--apply] [--verify] [--typecheck-node]",
    "",
    "Known targets:",
    ...Object.entries(KNOWN_EXTENSION_MIGRATION_TARGETS).map(
      ([name, target]) => `  ${name} -> ${target.extensionPath}`
    ),
    "",
    "Examples:",
    "  npm run migrate:extension -- github --mode shell --verify",
    "  npm run migrate:extension -- apple-reminders --mode shell --target-extension-id apple-reminders-generated --apply --verify"
  ].join("\n")
}

export function runMigrateExtensionCli(argv, io = {}) {
  const options = parseMigrateExtensionArgs(argv)
  if (options.help) {
    ;(io.stdout ?? process.stdout).write(`${formatUsage()}\n`)
    return
  }

  const plan = resolveMigrationRunPlan(options)
  runMigrateExtensionPlan(plan, io)
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    runMigrateExtensionCli(process.argv.slice(2))
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
