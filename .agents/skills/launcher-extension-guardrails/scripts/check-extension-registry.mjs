import path from "node:path"
import {
  fileExists,
  formatViolations,
  listNativeExtensionDirectories,
  loadNativeExtensionManifest,
  repoRoot
} from "./lib/architecture-guardrails.mjs"

const violations = []
const extensionNames = new Map()
const extensionTitles = new Map()

for (const extensionDirectory of listNativeExtensionDirectories()) {
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
  if (!manifest.commands.some((command) => command.name === defaultCommandName)) {
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

const extensionsRendererPath = path.join(repoRoot, "src/extensions/renderer.ts")
if (!fileExists(extensionsRendererPath)) {
  violations.push({
    file: "src/extensions/renderer.ts",
    reason: "缺少 native extension renderer registry"
  })
}

const extensionsMainPath = path.join(repoRoot, "src/extensions/main.ts")
if (!fileExists(extensionsMainPath)) {
  violations.push({
    file: "src/extensions/main.ts",
    reason: "缺少 native extension main registry"
  })
}

if (violations.length === 0) {
  console.log("extension registry check passed")
  process.exit(0)
}

console.error(formatViolations("extension registry check", violations))
process.exit(1)
