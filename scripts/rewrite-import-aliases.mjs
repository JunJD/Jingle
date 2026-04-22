import fs from "node:fs"
import path from "node:path"
import ts from "typescript"

const repoRoot = process.cwd()
const srcRoot = path.join(repoRoot, "src")
const moduleExtensions = [
  "",
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".d.ts",
  "/index.ts",
  "/index.tsx",
  "/index.mts",
  "/index.cts",
  "/index.js",
  "/index.jsx",
  "/index.mjs",
  "/index.cjs",
  "/index.d.ts"
]

const aliasRules = [
  {
    alias: "@ai-core",
    repoRoot: "src/renderer/src/ai-core",
    canUse: canUseRendererAlias
  },
  {
    alias: "@extension-host",
    repoRoot: "src/renderer/src/extension-host",
    canUse: canUseRendererAlias
  },
  {
    alias: "@launcher-components",
    repoRoot: "src/renderer/src/launcher-components",
    canUse: canUseRendererAlias
  },
  {
    alias: "@launcher-shell",
    repoRoot: "src/renderer/src/launcher-shell",
    canUse: canUseRendererAlias
  },
  {
    alias: "@renderer",
    repoRoot: "src/renderer/src",
    canUse: (sourceRepoPath) => sourceRepoPath === "src/extensions/api.ts"
  },
  {
    alias: "@shared",
    repoRoot: "src/shared",
    canUse: canUseCrossRootAlias
  },
  {
    alias: "@extensions",
    repoRoot: "src/extensions",
    canUse: canUseCrossRootAlias
  },
  {
    alias: "@plugins",
    repoRoot: "src/plugins",
    canUse: canUseCrossRootAlias
  }
]
  .map((rule) => ({
    ...rule,
    absoluteRoot: path.join(repoRoot, rule.repoRoot)
  }))
  .sort((left, right) => right.absoluteRoot.length - left.absoluteRoot.length)

function canUseCrossRootAlias(sourceRepoPath, rule) {
  return !isUnder(sourceRepoPath, `${rule.repoRoot}/`)
}

function canUseRendererAlias(sourceRepoPath, rule) {
  if (isUnder(sourceRepoPath, `${rule.repoRoot}/`)) {
    return false
  }

  return sourceRepoPath.startsWith("src/renderer/src/") || sourceRepoPath === "src/extensions/api.ts"
}

function isUnder(filePath, prefix) {
  return filePath.startsWith(prefix)
}

function toRepoPath(absolutePath) {
  return path.relative(repoRoot, absolutePath).split(path.sep).join("/")
}

function normalizeSlashes(filePath) {
  return filePath.split(path.sep).join("/")
}

function listSourceFiles(directory) {
  const files = []

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = path.join(directory, entry.name)

    if (entry.isDirectory()) {
      files.push(...listSourceFiles(absolutePath))
      continue
    }

    if (!/\.(?:[cm]?[jt]sx?|d\.ts)$/.test(entry.name)) {
      continue
    }

    files.push(absolutePath)
  }

  return files
}

function collectModuleSpecifiers(absoluteFilePath) {
  const sourceText = fs.readFileSync(absoluteFilePath, "utf8")
  const sourceFile = ts.createSourceFile(absoluteFilePath, sourceText, ts.ScriptTarget.Latest, true)
  const entries = []

  const addEntry = (literal) => {
    entries.push({
      specifier: literal.text,
      start: literal.getStart(sourceFile) + 1,
      end: literal.getEnd() - 1,
      line: sourceFile.getLineAndCharacterOfPosition(literal.getStart(sourceFile)).line + 1
    })
  }

  const visit = (node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      addEntry(node.moduleSpecifier)
    }

    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      addEntry(node.arguments[0])
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)

  return { sourceText, entries }
}

function resolveRelativeImport(fromFile, specifier) {
  if (!specifier.startsWith(".")) {
    return null
  }

  const base = path.resolve(path.dirname(fromFile), specifier)

  for (const extension of moduleExtensions) {
    const candidate = `${base}${extension}`

    if (!fs.existsSync(candidate)) {
      continue
    }

    if (!fs.statSync(candidate).isFile()) {
      continue
    }

    return candidate
  }

  return null
}

function buildAliasSpecifier(resolvedFile, originalSpecifier, rule) {
  const relativeToRoot = normalizeSlashes(path.relative(rule.absoluteRoot, resolvedFile))
  const withoutExtension = relativeToRoot.replace(/\.(?:d\.ts|[cm]?[jt]sx?)$/, "")
  const originalExplicitIndex = /(?:^|\/)index(?:\.(?:d\.ts|[cm]?[jt]sx?))?$/.test(originalSpecifier)
  let normalizedSubpath = withoutExtension

  if (withoutExtension.endsWith("/index") && !originalExplicitIndex) {
    normalizedSubpath = withoutExtension.slice(0, -"/index".length)
  }

  if (normalizedSubpath.length === 0) {
    normalizedSubpath = "index"
  }

  return `${rule.alias}/${normalizedSubpath}`
}

function pickAliasRule(sourceRepoPath, resolvedFile) {
  for (const rule of aliasRules) {
    if (!resolvedFile.startsWith(`${rule.absoluteRoot}${path.sep}`) && resolvedFile !== rule.absoluteRoot) {
      continue
    }

    if (!rule.canUse(sourceRepoPath, rule)) {
      continue
    }

    return rule
  }

  return null
}

function applyReplacements(sourceText, replacements) {
  let nextText = sourceText

  for (const replacement of [...replacements].sort((left, right) => right.start - left.start)) {
    nextText =
      nextText.slice(0, replacement.start) +
      replacement.nextSpecifier +
      nextText.slice(replacement.end)
  }

  return nextText
}

function parseArgs(argv) {
  const write = argv.includes("--write")
  const verbose = argv.includes("--verbose")

  return { write, verbose }
}

function formatReplacement(replacement) {
  return `${replacement.file}:${replacement.line} ${replacement.currentSpecifier} -> ${replacement.nextSpecifier}`
}

function summarize(replacementsByAlias) {
  return [...replacementsByAlias.entries()]
    .sort((left, right) => right[1] - left[1])
    .map(([alias, count]) => `${alias}: ${count}`)
    .join(", ")
}

function main() {
  const { write, verbose } = parseArgs(process.argv.slice(2))
  const sourceFiles = listSourceFiles(srcRoot)
  const fileChanges = new Map()
  const replacementsByAlias = new Map()
  let scannedRelativeImports = 0

  for (const absoluteFilePath of sourceFiles) {
    const repoFilePath = toRepoPath(absoluteFilePath)
    const { sourceText, entries } = collectModuleSpecifiers(absoluteFilePath)
    const replacements = []

    for (const entry of entries) {
      if (!entry.specifier.startsWith(".")) {
        continue
      }

      scannedRelativeImports += 1

      const resolvedFile = resolveRelativeImport(absoluteFilePath, entry.specifier)

      if (!resolvedFile) {
        continue
      }

      const rule = pickAliasRule(repoFilePath, resolvedFile)

      if (!rule) {
        continue
      }

      const nextSpecifier = buildAliasSpecifier(resolvedFile, entry.specifier, rule)

      if (nextSpecifier === entry.specifier) {
        continue
      }

      replacements.push({
        file: repoFilePath,
        line: entry.line,
        start: entry.start,
        end: entry.end,
        currentSpecifier: entry.specifier,
        nextSpecifier,
        alias: rule.alias
      })
    }

    if (replacements.length === 0) {
      continue
    }

    fileChanges.set(absoluteFilePath, {
      sourceText,
      repoFilePath,
      replacements
    })

    for (const replacement of replacements) {
      replacementsByAlias.set(replacement.alias, (replacementsByAlias.get(replacement.alias) ?? 0) + 1)
    }
  }

  const allReplacements = [...fileChanges.values()].flatMap((change) => change.replacements)

  console.log(`Scanned ${sourceFiles.length} source files`)
  console.log(`Scanned ${scannedRelativeImports} relative imports`)
  console.log(`Found ${allReplacements.length} alias replacements across ${fileChanges.size} files`)

  if (allReplacements.length > 0) {
    console.log(`By alias: ${summarize(replacementsByAlias)}`)
  }

  if (verbose) {
    for (const replacement of allReplacements) {
      console.log(formatReplacement(replacement))
    }
  }

  if (!write || fileChanges.size === 0) {
    return
  }

  for (const [absoluteFilePath, change] of fileChanges) {
    const nextText = applyReplacements(change.sourceText, change.replacements)
    fs.writeFileSync(absoluteFilePath, nextText)
  }

  console.log(`Wrote ${allReplacements.length} replacements`)
}

main()
