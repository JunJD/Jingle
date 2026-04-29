/* eslint-disable @typescript-eslint/explicit-function-return-type */
import path from "node:path"
import {
  collectImports,
  formatViolations,
  isExact,
  isUnder,
  listNativeExtensionDirectories,
  listSourceFiles,
  loadNativeExtensionManifest,
  resolveExtensionCommandFile,
  resolveImportPath,
  srcRoot,
  toRepoPath
} from "./lib/architecture-guardrails.mjs"

const violations = []

function isRendererImportOwner(repoFilePath) {
  return (
    isUnder(repoFilePath, "src/renderer/") ||
    isExact(repoFilePath, "src/extensions/renderer.ts") ||
    /^src\/extensions\/[^/]+\/renderer\.ts$/.test(repoFilePath)
  )
}

const runtimeCommandFiles = new Map()

for (const extensionDirectory of listNativeExtensionDirectories()) {
  const manifest = loadNativeExtensionManifest(extensionDirectory)
  for (const command of manifest.commands.filter((entry) => entry.runtime)) {
    const commandFile = resolveExtensionCommandFile(extensionDirectory, command.name)
    if (!commandFile) {
      violations.push({
        file: `${extensionDirectory.repoPath}/manifest.ts`,
        reason: `runtime command "${manifest.name}:${command.name}" does not resolve to an extension command file`
      })
      continue
    }

    runtimeCommandFiles.set(path.resolve(commandFile), {
      commandName: command.name,
      extensionName: manifest.name
    })
  }
}

if (runtimeCommandFiles.size > 0) {
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

      const command = runtimeCommandFiles.get(path.resolve(resolved))
      if (!command) {
        continue
      }

      violations.push({
        file: repoFilePath,
        import: entry.specifier,
        line: entry.line,
        reason: `runtime command "${command.extensionName}:${command.commandName}" must not be imported by renderer code`,
        target: toRepoPath(path.resolve(resolved))
      })
    }
  }
}

if (violations.length === 0) {
  console.log("runtime command renderer import check passed")
  process.exit(0)
}

console.error(formatViolations("runtime command renderer import check", violations))
process.exit(1)
