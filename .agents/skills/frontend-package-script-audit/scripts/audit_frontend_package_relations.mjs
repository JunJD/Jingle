#!/usr/bin/env node

import { builtinModules } from "node:module"
import { promises as fs } from "node:fs"
import path from "node:path"

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"])
const SKIP_DIRECTORIES = new Set(["node_modules", ".git", "dist", "out", "coverage"])
const PACKAGE_COMMAND_ALIASES = {
  electron: ["electron"],
  "electron-vite": ["electron-vite"],
  eslint: ["eslint"],
  prettier: ["prettier"],
  prisma: ["prisma"],
  tailwindcss: ["tailwindcss"],
  typescript: ["tsc"],
  vite: ["vite"]
}
const BUILTIN_MODULES = new Set(
  builtinModules.flatMap((name) => {
    const normalized = name.replace(/^node:/, "")
    return [name, normalized]
  })
)

function parseArgs(argv) {
  const options = {
    frontend: [],
    json: false,
    root: process.cwd()
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]

    if (arg === "--json") {
      options.json = true
      continue
    }

    if (arg === "--root") {
      options.root = argv[index + 1] ?? options.root
      index += 1
      continue
    }

    if (arg === "--frontend") {
      const value = argv[index + 1]
      if (value) {
        options.frontend.push(value)
      }
      index += 1
      continue
    }
  }

  if (options.frontend.length === 0) {
    options.frontend.push("src/renderer/src")
  }

  return options
}

function isBarePackageSpecifier(specifier) {
  if (
    !specifier ||
    specifier.startsWith(".") ||
    specifier.startsWith("/") ||
    specifier.startsWith("@/") ||
    specifier.startsWith("~/") ||
    specifier.startsWith("node:") ||
    specifier.startsWith("data:") ||
    specifier.startsWith("http://") ||
    specifier.startsWith("https://") ||
    specifier.startsWith("virtual:")
  ) {
    return false
  }

  return !BUILTIN_MODULES.has(specifier)
}

function normalizePackageName(specifier) {
  if (specifier.startsWith("@")) {
    const [scope, name] = specifier.split("/")
    return name ? `${scope}/${name}` : specifier
  }

  return specifier.split("/")[0]
}

function extractImportSpecifiers(source) {
  const matches = new Set()
  const patterns = [
    /\bimport\s+(?:[^"'`]+?\s+from\s+)?["'`]([^"'`]+)["'`]/g,
    /\bexport\s+(?:[^"'`]+?\s+from\s+)?["'`]([^"'`]+)["'`]/g,
    /\bimport\s*\(\s*["'`]([^"'`]+)["'`]\s*\)/g,
    /\brequire\s*\(\s*["'`]([^"'`]+)["'`]\s*\)/g
  ]

  for (const pattern of patterns) {
    let result = pattern.exec(source)
    while (result) {
      matches.add(result[1])
      result = pattern.exec(source)
    }
  }

  return [...matches]
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath)
    return true
  } catch {
    return false
  }
}

async function collectSourceFiles(targetPath, files = []) {
  const entries = await fs.readdir(targetPath, { withFileTypes: true })

  for (const entry of entries) {
    if (entry.name.startsWith(".") && entry.name !== ".storybook") {
      continue
    }

    const nextPath = path.join(targetPath, entry.name)

    if (entry.isDirectory()) {
      if (SKIP_DIRECTORIES.has(entry.name)) {
        continue
      }

      await collectSourceFiles(nextPath, files)
      continue
    }

    if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
      files.push(nextPath)
    }
  }

  return files
}

function makePackageAliases(packageName) {
  const aliases = new Set([packageName])
  const extraAliases = PACKAGE_COMMAND_ALIASES[packageName] ?? []

  for (const alias of extraAliases) {
    aliases.add(alias)
  }

  return [...aliases]
}

function extractScriptCommandTokens(command) {
  const tokens = []
  const segments = command.split(/&&|\|\||;|\n/g)

  for (const rawSegment of segments) {
    const parts = rawSegment.trim().split(/\s+/).filter(Boolean)
    if (parts.length === 0) {
      continue
    }

    let cursor = 0
    while (
      cursor < parts.length &&
      /^[A-Za-z_][A-Za-z0-9_]*=/.test(parts[cursor]) &&
      !parts[cursor].startsWith("./") &&
      !parts[cursor].startsWith("/")
    ) {
      cursor += 1
    }

    if (cursor >= parts.length) {
      continue
    }

    const commandToken = parts[cursor]
    if (["pnpm", "pnpx", "npx", "bunx"].includes(commandToken) && parts[cursor + 1]) {
      tokens.push(parts[cursor + 1])
      continue
    }

    if (["npm", "yarn", "bun"].includes(commandToken)) {
      continue
    }

    tokens.push(commandToken)
  }

  return tokens
}

function sortObjectKeys(values) {
  return Object.fromEntries(Object.entries(values).sort(([left], [right]) => left.localeCompare(right)))
}

function toSortedArray(values) {
  return [...values].sort((left, right) => left.localeCompare(right))
}

function formatPackageList(items, emptyLabel = "(none)") {
  if (items.length === 0) {
    return [emptyLabel]
  }

  return items.map((item) => `- ${item}`)
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const root = path.resolve(options.root)
  const packageJsonPath = path.join(root, "package.json")
  const packageJson = JSON.parse(await fs.readFile(packageJsonPath, "utf8"))
  const dependencies = packageJson.dependencies ?? {}
  const devDependencies = packageJson.devDependencies ?? {}
  const scripts = packageJson.scripts ?? {}
  const declaredPackages = new Set([
    ...Object.keys(dependencies),
    ...Object.keys(devDependencies)
  ])

  const frontendRoots = []
  for (const frontendRoot of options.frontend) {
    const absolutePath = path.resolve(root, frontendRoot)
    if (!(await pathExists(absolutePath))) {
      throw new Error(`Frontend path does not exist: ${frontendRoot}`)
    }
    frontendRoots.push(absolutePath)
  }

  const packageImports = new Map()
  let filesScanned = 0

  for (const frontendRoot of frontendRoots) {
    const sourceFiles = await collectSourceFiles(frontendRoot)
    filesScanned += sourceFiles.length

    for (const filePath of sourceFiles) {
      const source = await fs.readFile(filePath, "utf8")
      for (const specifier of extractImportSpecifiers(source)) {
        if (!isBarePackageSpecifier(specifier)) {
          continue
        }

        const packageName = normalizePackageName(specifier)
        const record = packageImports.get(packageName) ?? {
          files: new Set(),
          specifiers: new Set()
        }
        record.files.add(path.relative(root, filePath))
        record.specifiers.add(specifier)
        packageImports.set(packageName, record)
      }
    }
  }

  const missingDeclarations = []
  const importedFromDevDependencies = []
  const importedPackages = []

  for (const [packageName, record] of [...packageImports.entries()].sort(([left], [right]) =>
    left.localeCompare(right)
  )) {
    const declaredIn = packageName in dependencies
      ? "dependencies"
      : packageName in devDependencies
        ? "devDependencies"
        : null

    if (!declaredIn) {
      missingDeclarations.push(packageName)
    }

    if (declaredIn === "devDependencies") {
      importedFromDevDependencies.push(packageName)
    }

    importedPackages.push({
      declaredIn,
      files: toSortedArray(record.files),
      name: packageName,
      specifiers: toSortedArray(record.specifiers)
    })
  }

  const scriptReferencedPackages = new Map()
  const scriptCommandTokens = {}

  for (const [scriptName, command] of Object.entries(scripts)) {
    const tokens = extractScriptCommandTokens(command)
    scriptCommandTokens[scriptName] = tokens

    for (const packageName of declaredPackages) {
      const aliases = makePackageAliases(packageName)
      if (!aliases.some((alias) => tokens.includes(alias))) {
        continue
      }

      const seen = scriptReferencedPackages.get(packageName) ?? new Set()
      seen.add(scriptName)
      scriptReferencedPackages.set(packageName, seen)
    }
  }

  const seenByAudit = new Set([
    ...packageImports.keys(),
    ...scriptReferencedPackages.keys()
  ])
  const declaredButNotSeenByThisAudit = {
    dependencies: Object.keys(dependencies)
      .filter((packageName) => !seenByAudit.has(packageName))
      .sort((left, right) => left.localeCompare(right)),
    devDependencies: Object.keys(devDependencies)
      .filter((packageName) => !seenByAudit.has(packageName))
      .sort((left, right) => left.localeCompare(right))
  }

  const report = {
    declaredButNotSeenByThisAudit,
    filesScanned,
    frontendRoots: frontendRoots.map((frontendRoot) => path.relative(root, frontendRoot)),
    importedFromDevDependencies,
    importedPackages,
    missingDeclarations,
    root,
    scriptCommandTokens: sortObjectKeys(scriptCommandTokens),
    scriptReferencedPackages: [...scriptReferencedPackages.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, usedByScripts]) => ({
        name,
        scripts: toSortedArray(usedByScripts)
      }))
  }

  if (options.json) {
    console.log(JSON.stringify(report, null, 2))
    return
  }

  const lines = [
    `repo: ${report.root}`,
    `frontend roots: ${report.frontendRoots.join(", ")}`,
    `files scanned: ${report.filesScanned}`,
    "",
    "frontend imported packages:"
  ]

  for (const item of report.importedPackages) {
    const location = item.declaredIn ?? "missing"
    lines.push(`- ${item.name} (${location})`)
  }

  lines.push("", "missing declarations:")
  lines.push(...formatPackageList(report.missingDeclarations))

  lines.push("", "frontend imports declared in devDependencies:")
  lines.push(...formatPackageList(report.importedFromDevDependencies))

  lines.push("", "script referenced packages:")
  if (report.scriptReferencedPackages.length === 0) {
    lines.push("(none)")
  } else {
    for (const item of report.scriptReferencedPackages) {
      lines.push(`- ${item.name}: ${item.scripts.join(", ")}`)
    }
  }

  lines.push("", "declared but not seen by this audit:")
  lines.push("dependencies:")
  lines.push(...formatPackageList(report.declaredButNotSeenByThisAudit.dependencies))
  lines.push("devDependencies:")
  lines.push(...formatPackageList(report.declaredButNotSeenByThisAudit.devDependencies))
  lines.push(
    "",
    "note: 'declared but not seen by this audit' only means not imported by the audited frontend roots and not directly referenced by package.json scripts."
  )

  console.log(lines.join("\n"))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
