import path from "node:path"
import {
  fileExists,
  formatViolations,
  listNativeExtensionDirectories,
  loadNativeExtensionDefinition,
  loadNativeExtensionManifest,
  resolveExtensionRelativeFile
} from "./lib/architecture-guardrails.mjs"

const violations = []

for (const extensionDirectory of listNativeExtensionDirectories()) {
  const manifestPath = path.join(extensionDirectory.absolutePath, "manifest.ts")
  const indexPath = path.join(extensionDirectory.absolutePath, "index.ts")

  if (!fileExists(manifestPath)) {
    violations.push({
      file: `${extensionDirectory.repoPath}/manifest.ts`,
      reason: "native extension 缺少 manifest.ts"
    })
    continue
  }

  if (!fileExists(indexPath)) {
    violations.push({
      file: `${extensionDirectory.repoPath}/index.ts`,
      reason: "native extension 缺少 index.ts"
    })
    continue
  }

  const manifest = loadNativeExtensionManifest(extensionDirectory)
  const definition = loadNativeExtensionDefinition(extensionDirectory)
  const manifestCommandMap = new Map(manifest.commands.map((command) => [command.name, command]))
  const definitionCommandMap = new Map(definition.commands.map((command) => [command.name, command]))

  if (manifest.name !== extensionDirectory.name) {
    violations.push({
      file: `${extensionDirectory.repoPath}/manifest.ts`,
      reason: `manifest.name 应与目录名一致；当前目录是 "${extensionDirectory.name}"，manifest.name 是 "${manifest.name}"`
    })
  }

  for (const command of manifest.commands) {
    const commandReference = definitionCommandMap.get(command.name)
    if (!commandReference) {
      violations.push({
        file: `${extensionDirectory.repoPath}/index.ts`,
        reason: `manifest 声明了 command "${command.name}"，但 index.ts 没有导出对应 modulePath`
      })
      continue
    }

    const commandFilePath = resolveExtensionRelativeFile(
      extensionDirectory,
      commandReference.modulePath.slice(2)
    )

    if (!fileExists(commandFilePath)) {
      violations.push({
        file: `${extensionDirectory.repoPath}/index.ts`,
        reason: `command "${command.name}" 指向的文件不存在：${commandReference.modulePath}`
      })
    }

    if (!commandReference.modulePath.startsWith("./src/")) {
      violations.push({
        file: `${extensionDirectory.repoPath}/index.ts`,
        reason: `command "${command.name}" 的 modulePath 必须位于 ./src/ 下`
      })
    }

    if (command.mode === "view") {
      const metaFilePath = commandFilePath.replace(/\.(ts|tsx)$/, ".meta.ts")
      if (!fileExists(metaFilePath)) {
        violations.push({
          file: `${extensionDirectory.repoPath}/${commandReference.modulePath.slice(2)}`,
          reason: `view command "${command.name}" 缺少对应的 .meta.ts 文件`
        })
      }
    }
  }

  for (const commandReference of definition.commands) {
    if (!manifestCommandMap.has(commandReference.name)) {
      violations.push({
        file: `${extensionDirectory.repoPath}/index.ts`,
        reason: `index.ts 导出了 command "${commandReference.name}"，但 manifest.ts 未声明`
      })
    }
  }

  if (definition.serviceModulePath) {
    const servicePath = resolveExtensionRelativeFile(
      extensionDirectory,
      definition.serviceModulePath.slice(2)
    )

    if (!fileExists(servicePath)) {
      violations.push({
        file: `${extensionDirectory.repoPath}/index.ts`,
        reason: `serviceModulePath 指向的文件不存在：${definition.serviceModulePath}`
      })
    }
  }

  if ((manifest.rpcMethods?.length ?? 0) > 0 && !definition.serviceModulePath) {
    violations.push({
      file: `${extensionDirectory.repoPath}/manifest.ts`,
      reason: "声明了 rpcMethods，但 index.ts 没有 serviceModulePath"
    })
  }
}

if (violations.length === 0) {
  console.log("extension contract check passed")
  process.exit(0)
}

console.error(formatViolations("extension contract check", violations))
process.exit(1)
