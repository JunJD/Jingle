import path from "node:path"
import {
  fileExists,
  formatViolations,
  listNativeExtensionDirectories,
  loadNativeExtensionManifest,
  listNativeExtensionRendererCommandNames,
  nativeExtensionMainDeclaresService,
  resolveExtensionCommandFile
} from "./lib/architecture-guardrails.mjs"

const violations = []

for (const extensionDirectory of listNativeExtensionDirectories()) {
  const manifestPath = path.join(extensionDirectory.absolutePath, "manifest.ts")
  const rendererPath = path.join(extensionDirectory.absolutePath, "renderer.ts")
  const mainPath = path.join(extensionDirectory.absolutePath, "main.ts")

  if (!fileExists(manifestPath)) {
    violations.push({
      file: `${extensionDirectory.repoPath}/manifest.ts`,
      reason: "native extension 缺少 manifest.ts"
    })
    continue
  }

  if (!fileExists(rendererPath)) {
    violations.push({
      file: `${extensionDirectory.repoPath}/renderer.ts`,
      reason: "native extension 缺少 renderer.ts"
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
  const manifestCommandMap = new Map(manifest.commands.map((command) => [command.name, command]))
  const rendererCommandNames = listNativeExtensionRendererCommandNames(extensionDirectory)
  const definitionCommandMap = new Map(
    rendererCommandNames.map((commandName) => [commandName, true])
  )

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
        file: `${extensionDirectory.repoPath}/renderer.ts`,
        reason: `manifest 声明了 command "${command.name}"，但 renderer.ts 没有导出对应 command name`
      })
      continue
    }

    const commandFilePath = resolveExtensionCommandFile(extensionDirectory, command.name)

    if (!commandFilePath || !fileExists(commandFilePath)) {
      violations.push({
        file: `${extensionDirectory.repoPath}/index.ts`,
        reason: `command "${command.name}" 对应的文件不存在：src/${command.name}.ts(x)`
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

  for (const commandName of rendererCommandNames) {
    if (!manifestCommandMap.has(commandName)) {
      violations.push({
        file: `${extensionDirectory.repoPath}/renderer.ts`,
        reason: `renderer.ts 导出了 command "${commandName}"，但 manifest.ts 未声明`
      })
    }
  }

  if (
    (manifest.rpcMethods?.length ?? 0) > 0 &&
    !nativeExtensionMainDeclaresService(extensionDirectory)
  ) {
    violations.push({
      file: `${extensionDirectory.repoPath}/main.ts`,
      reason: "声明了 rpcMethods，但 main.ts 没有导出对应 service"
    })
  }
}

if (violations.length === 0) {
  console.log("extension contract check passed")
  process.exit(0)
}

console.error(formatViolations("extension contract check", violations))
process.exit(1)
