import path from "node:path"
import {
  fileExists,
  formatViolations,
  listBuiltInRegistryExtensionDirectories,
  loadNativeExtensionManifest,
  nativeExtensionMainDeclaresService,
  resolveExtensionCommandFile
} from "./lib/architecture-guardrails.mjs"

const violations = []

for (const extensionDirectory of listBuiltInRegistryExtensionDirectories()) {
  const manifestPath = path.join(extensionDirectory.absolutePath, "manifest.ts")
  const mainPath = path.join(extensionDirectory.absolutePath, "main.ts")

  if (!fileExists(manifestPath)) {
    violations.push({
      file: `${extensionDirectory.repoPath}/manifest.ts`,
      reason: "native extension 缺少 manifest.ts"
    })
    continue
  }

  if (!fileExists(mainPath)) {
    violations.push({
      file: `${extensionDirectory.repoPath}/main.ts`,
      reason: "native extension 缺少 main.ts"
    })
    continue
  }

  const manifest = loadNativeExtensionManifest(extensionDirectory)

  if (manifest.name !== extensionDirectory.name) {
    violations.push({
      file: `${extensionDirectory.repoPath}/manifest.ts`,
      reason: `manifest.name 应与目录名一致；当前目录是 "${extensionDirectory.name}"，manifest.name 是 "${manifest.name}"`
    })
  }

  for (const command of manifest.commands) {
    if (!command.runtime) {
      violations.push({
        file: `${extensionDirectory.repoPath}/manifest.ts`,
        reason: `command "${command.name}" 必须声明 runtime metadata`
      })
      continue
    }

    const commandFilePath = resolveExtensionCommandFile(extensionDirectory, command.name)

    if (!commandFilePath || !fileExists(commandFilePath)) {
      violations.push({
        file: `${extensionDirectory.repoPath}/manifest.ts`,
        reason: `command "${command.name}" 对应的文件不存在：${extensionDirectory.repoPath}/src/${command.name}.ts(x)`
      })
      continue
    }

    if (command.mode === "view") {
      const metaFilePath = commandFilePath.replace(/\.(ts|tsx)$/, ".meta.ts")
      if (!fileExists(metaFilePath)) {
        violations.push({
          file: `${extensionDirectory.repoPath}/src/${command.name}.ts(x)`,
          reason: `view command "${command.name}" 缺少对应的 .meta.ts 文件`
        })
      }
    }
  }

  if ((manifest.rpcMethods?.length ?? 0) > 0) {
    try {
      if (!nativeExtensionMainDeclaresService(extensionDirectory)) {
        violations.push({
          file: `${extensionDirectory.repoPath}/main.ts`,
          reason: "声明了 rpcMethods，但 main.ts 没有导出对应 service"
        })
      }
    } catch (error) {
      violations.push({
        file: `${extensionDirectory.repoPath}/main.ts`,
        reason: error instanceof Error ? error.message : String(error)
      })
    }
  }
}

if (violations.length === 0) {
  console.log("extension contract check passed")
  process.exit(0)
}

console.error(formatViolations("extension contract check", violations))
process.exit(1)
