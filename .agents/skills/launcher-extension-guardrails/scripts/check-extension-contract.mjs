import path from "node:path"
import {
  fileExists,
  formatViolations,
  listNativeExtensionDirectories,
  loadNativeExtensionManifest,
  listNativeExtensionRendererCommandNames,
  nativeExtensionMainDeclaresService,
  readSourceText,
  resolveExtensionCommandFile
} from "./lib/architecture-guardrails.mjs"

const violations = []
const runtimeBackedCommands = listRuntimeBackedCommands()

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
  const runtimeBackedCommandNames = runtimeBackedCommands.get(manifest.name) ?? new Set()
  let rendererCommandNames = []

  try {
    rendererCommandNames = listNativeExtensionRendererCommandNames(extensionDirectory)
  } catch (error) {
    violations.push({
      file: `${extensionDirectory.repoPath}/renderer.ts`,
      reason: error instanceof Error ? error.message : String(error)
    })
    continue
  }

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
    if (!commandReference && !runtimeBackedCommandNames.has(command.name)) {
      violations.push({
        file: `${extensionDirectory.repoPath}/renderer.ts`,
        reason: `manifest 声明了 command "${command.name}"，但 renderer.ts 没有导出对应 command name`
      })
      continue
    }

    if (commandReference && runtimeBackedCommandNames.has(command.name)) {
      violations.push({
        file: `${extensionDirectory.repoPath}/renderer.ts`,
        reason: `runtime-backed command "${command.name}" 不应由 renderer.ts 导出`
      })
      continue
    }

    const commandFilePath = resolveExtensionCommandFile(extensionDirectory, command.name)

    if (!commandFilePath || !fileExists(commandFilePath)) {
      violations.push({
        file: `${extensionDirectory.repoPath}/renderer.ts`,
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

  for (const commandName of rendererCommandNames) {
    if (!manifestCommandMap.has(commandName)) {
      violations.push({
        file: `${extensionDirectory.repoPath}/renderer.ts`,
        reason: `renderer.ts 导出了 command "${commandName}"，但 manifest.ts 未声明`
      })
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

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
function listRuntimeBackedCommands() {
  const registryPath = "src/extensions/runtime-backed.ts"
  const sourceText = readSourceText(registryPath)
  const commands = new Map()
  const entryPattern = /extensionName:\s*["']([^"']+)["'][\s\S]*?commandName:\s*["']([^"']+)["']/g

  for (const match of sourceText.matchAll(entryPattern)) {
    const extensionName = match[1]
    const commandName = match[2]
    const commandNames = commands.get(extensionName) ?? new Set()
    commandNames.add(commandName)
    commands.set(extensionName, commandNames)
  }

  return commands
}
