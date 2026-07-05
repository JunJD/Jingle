import path from "node:path"
import {
  fileExists,
  formatViolations,
  isInstallableExtensionDirectory,
  listBuiltInRegistryExtensionDirectories,
  listTopLevelMainRegistryExtensionNames,
  listTopLevelManifestRegistryExtensionNames,
  loadNativeExtensionManifest,
  repoRoot
} from "./lib/architecture-guardrails.mjs"

const violations = []
const extensionNames = new Map()
const extensionTitles = new Map()
const extensionDirectories = listBuiltInRegistryExtensionDirectories()
const builtInExtensionDirectories = extensionDirectories.filter(
  (directory) => !isInstallableExtensionDirectory(directory)
)
const builtInDirectoryExtensionIds = new Set(
  builtInExtensionDirectories.map((directory) => directory.name)
)
const installableDirectoryExtensionIds = new Set(
  extensionDirectories
    .filter((directory) => isInstallableExtensionDirectory(directory))
    .map((directory) => directory.name)
)

for (const extensionDirectory of extensionDirectories) {
  const manifest = loadNativeExtensionManifest(extensionDirectory)

  if (extensionNames.has(manifest.name)) {
    violations.push({
      file: `${extensionDirectory.repoPath}/manifest.ts`,
      reason: `extension id "${manifest.name}" 与 ${extensionNames.get(manifest.name)} 重复`
    })
  } else {
    extensionNames.set(manifest.name, `${extensionDirectory.repoPath}/manifest.ts`)
  }

  if (extensionTitles.has(manifest.title)) {
    violations.push({
      file: `${extensionDirectory.repoPath}/manifest.ts`,
      reason: `extension title "${manifest.title}" 与 ${extensionTitles.get(manifest.title)} 重复`
    })
  } else {
    extensionTitles.set(manifest.title, `${extensionDirectory.repoPath}/manifest.ts`)
  }

  const defaultCommandName = manifest.defaultCommandName ?? manifest.commands[0]?.name
  if (
    manifest.commands.length > 0 &&
    !manifest.commands.some((command) => command.name === defaultCommandName)
  ) {
    violations.push({
      file: `${extensionDirectory.repoPath}/manifest.ts`,
      reason: `defaultCommandName "${defaultCommandName}" 没有出现在 manifest.commands 里`
    })
  }
}

const extensionsIndexPath = path.join(repoRoot, "src/extensions/index.ts")
if (!fileExists(extensionsIndexPath)) {
  violations.push({
    file: "src/extensions/index.ts",
    reason: "缺少 native extension registry 入口文件"
  })
}

const extensionsMainPath = path.join(repoRoot, "src/extensions/main.ts")
if (!fileExists(extensionsMainPath)) {
  violations.push({
    file: "src/extensions/main.ts",
    reason: "缺少 native extension main registry"
  })
}

if (fileExists(extensionsIndexPath)) {
  try {
    compareRegistryCoverage(
      "src/extensions/index.ts",
      new Set(listTopLevelManifestRegistryExtensionNames())
    )
  } catch (error) {
    violations.push({
      file: "src/extensions/index.ts",
      reason: error instanceof Error ? error.message : String(error)
    })
  }
}

if (fileExists(extensionsMainPath)) {
  try {
    compareRegistryCoverage(
      "src/extensions/main.ts",
      new Set(listTopLevelMainRegistryExtensionNames())
    )
  } catch (error) {
    violations.push({
      file: "src/extensions/main.ts",
      reason: error instanceof Error ? error.message : String(error)
    })
  }
}

if (violations.length === 0) {
  console.log("extension registry check passed")
  process.exit(0)
}

console.error(formatViolations("extension registry check", violations))
process.exit(1)

function compareRegistryCoverage(file, registryExtensionIds) {
  for (const extensionId of builtInDirectoryExtensionIds) {
    if (!registryExtensionIds.has(extensionId)) {
      violations.push({
        file,
        reason: `built-in extension "${extensionId}" 存在于 extension package root，但没有被顶层 registry 收录`
      })
    }
  }

  for (const extensionId of registryExtensionIds) {
    if (installableDirectoryExtensionIds.has(extensionId)) {
      violations.push({
        file,
        reason: `installable extension "${extensionId}" 不应被 built-in 顶层 registry 收录`
      })
      continue
    }

    if (!builtInDirectoryExtensionIds.has(extensionId)) {
      violations.push({
        file,
        reason: `顶层 registry 收录了 extension "${extensionId}"，但 extension package root 不存在`
      })
    }
  }
}
