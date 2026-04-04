import path from "node:path"
import {
  collectImports,
  formatViolations,
  isExact,
  isUnder,
  listSourceFiles,
  repoRoot,
  resolveImportPath,
  srcRoot,
  toRepoPath
} from "./lib/architecture-guardrails.mjs"

const legacyMatchers = [
  "/built-plugins/",
  "/LauncherPluginHost",
  "/LauncherPluginHostContext",
  "/shared/launcher-plugin.ts"
]

const violations = []

for (const absoluteFilePath of listSourceFiles(path.join(srcRoot, "extensions"))) {
  const repoFilePath = toRepoPath(absoluteFilePath)
  const imports = collectImports(absoluteFilePath)

  for (const entry of imports) {
    const resolved = resolveImportPath(absoluteFilePath, entry.specifier)
    const targetPath = resolved ? toRepoPath(path.resolve(resolved)) : entry.specifier

    if (!shouldCheck(repoFilePath, targetPath)) {
      continue
    }

    const matched = legacyMatchers.find((matcher) => targetPath.includes(matcher))
    if (!matched) {
      continue
    }

    violations.push({
      file: repoFilePath,
      import: entry.specifier,
      line: entry.line,
      target: targetPath,
      reason: "native extension 新代码不能继续直接依赖旧 launcher plugin 骨架"
    })
  }
}

if (violations.length === 0) {
  console.log("no legacy plugin coupling check passed")
  process.exit(0)
}

console.error(formatViolations("no legacy plugin coupling check", violations))
process.exit(1)

function shouldCheck(file, target) {
  if (isExact(file, "src/extensions/api.ts")) {
    return true
  }

  if (!isUnder(file, "src/extensions/")) {
    return false
  }

  if (file.includes("/main/")) {
    return false
  }

  return isUnder(target, "src/renderer/") || isUnder(target, "src/shared/")
}
