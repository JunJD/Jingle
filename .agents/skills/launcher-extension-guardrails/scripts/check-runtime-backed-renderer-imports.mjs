/* eslint-disable @typescript-eslint/explicit-function-return-type */
import path from "node:path"
import {
  collectImports,
  fileExists,
  formatViolations,
  isExact,
  isUnder,
  listNativeExtensionDirectories,
  listSourceFiles,
  readSourceText,
  repoRoot,
  resolveExtensionCommandFile,
  resolveImportPath,
  srcRoot,
  toRepoPath
} from "./lib/architecture-guardrails.mjs"

const registryPath = "src/extensions/runtime-backed.ts"
const violations = []

function listRuntimeBackedCommands() {
  if (!fileExists(path.join(repoRoot, registryPath))) {
    return []
  }

  const sourceText = readSourceText(registryPath)
  const entries = []
  const entryPattern = /extensionName:\s*["']([^"']+)["'][\s\S]*?commandName:\s*["']([^"']+)["']/g

  for (const match of sourceText.matchAll(entryPattern)) {
    entries.push({
      commandName: match[2],
      extensionName: match[1]
    })
  }

  return entries
}

function isRendererImportOwner(repoFilePath) {
  return (
    isUnder(repoFilePath, "src/renderer/") ||
    isExact(repoFilePath, "src/extensions/renderer.ts") ||
    /^src\/extensions\/[^/]+\/renderer\.ts$/.test(repoFilePath)
  )
}

const extensionDirectories = new Map(
  listNativeExtensionDirectories().map((extensionDirectory) => [
    extensionDirectory.name,
    extensionDirectory
  ])
)

const runtimeBackedCommandFiles = new Map()

for (const command of listRuntimeBackedCommands()) {
  const extensionDirectory = extensionDirectories.get(command.extensionName)
  if (!extensionDirectory) {
    violations.push({
      file: registryPath,
      reason: `runtime-backed command references unknown extension "${command.extensionName}"`
    })
    continue
  }

  const commandFile = resolveExtensionCommandFile(extensionDirectory, command.commandName)
  if (!commandFile) {
    violations.push({
      file: registryPath,
      reason: `runtime-backed command "${command.extensionName}:${command.commandName}" does not resolve to an extension command file`
    })
    continue
  }

  runtimeBackedCommandFiles.set(path.resolve(commandFile), command)
}

if (runtimeBackedCommandFiles.size > 0) {
  for (const absoluteFilePath of listSourceFiles(srcRoot)) {
    const repoFilePath = toRepoPath(absoluteFilePath)
    if (!isRendererImportOwner(repoFilePath)) {
      continue
    }

    for (const entry of collectImports(absoluteFilePath)) {
      const resolved = resolveImportPath(absoluteFilePath, entry.specifier)
      if (!resolved) {
        continue
      }

      const command = runtimeBackedCommandFiles.get(path.resolve(resolved))
      if (!command) {
        continue
      }

      violations.push({
        file: repoFilePath,
        import: entry.specifier,
        line: entry.line,
        reason: `runtime-backed command "${command.extensionName}:${command.commandName}" must not be imported by renderer code`,
        target: toRepoPath(path.resolve(resolved))
      })
    }
  }
}

if (violations.length === 0) {
  console.log("runtime-backed renderer import check passed")
  process.exit(0)
}

console.error(formatViolations("runtime-backed renderer import check", violations))
process.exit(1)
