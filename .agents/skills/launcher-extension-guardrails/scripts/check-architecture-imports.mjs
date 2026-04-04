import path from "node:path"
import {
  collectImports,
  formatViolations,
  isExact,
  isUnder,
  listSourceFiles,
  resolveImportPath,
  srcRoot,
  toRepoPath
} from "./lib/architecture-guardrails.mjs"

const rules = [
  {
    name: "shared-host-agnostic",
    appliesTo: (file) => isUnder(file, "src/shared/"),
    isViolation: (_, target) =>
      isUnder(target, "src/renderer/") ||
      isUnder(target, "src/main/") ||
      isUnder(target, "src/preload/") ||
      isUnder(target, "src/extensions/") ||
      isUnder(target, "src/plugins/"),
    message: "shared 层不能依赖 renderer/main/preload/extensions/plugins"
  },
  {
    name: "extension-authoring-boundary",
    appliesTo: (file) =>
      isUnder(file, "src/extensions/") &&
      !isExact(file, "src/extensions/api.ts") &&
      !file.includes("/main/"),
    isViolation: (_, target) =>
      isUnder(target, "src/renderer/") ||
      isUnder(target, "src/main/") ||
      isUnder(target, "src/preload/") ||
      isUnder(target, "src/plugins/"),
    message: "extension 运行时代码只能通过 src/extensions/api.ts 和 shared/* 接宿主能力"
  },
  {
    name: "extension-main-boundary",
    appliesTo: (file) => isUnder(file, "src/extensions/") && file.includes("/main/"),
    isViolation: (_, target) =>
      isUnder(target, "src/renderer/") ||
      isUnder(target, "src/preload/") ||
      isUnder(target, "src/plugins/"),
    message: "extension main 代码不能依赖 renderer/preload/plugins"
  },
  {
    name: "extension-api-bridge",
    appliesTo: (file) => isExact(file, "src/extensions/api.ts"),
    isViolation: (_, target) =>
      isUnder(target, "src/main/") ||
      isUnder(target, "src/preload/") ||
      isUnder(target, "src/plugins/") ||
      (isUnder(target, "src/renderer/src/") &&
        !isUnder(target, "src/renderer/src/extension-host/") &&
        !isUnder(target, "src/renderer/src/ai-core/") &&
        !isExact(target, "src/renderer/src/lib/i18n/index.tsx")) ||
      (isUnder(target, "src/renderer/src/lib/") &&
        !isExact(target, "src/renderer/src/lib/i18n/index.tsx")),
    message:
      "src/extensions/api.ts 只能桥接 native extension runtime，以及明确开放的通用 renderer 能力"
  }
]

const violations = []

for (const absoluteFilePath of listSourceFiles(srcRoot)) {
  const repoFilePath = toRepoPath(absoluteFilePath)
  const imports = collectImports(absoluteFilePath)

  for (const entry of imports) {
    const resolved = resolveImportPath(absoluteFilePath, entry.specifier)
    if (!resolved) {
      continue
    }

    const repoTargetPath = toRepoPath(path.resolve(resolved))

    for (const rule of rules) {
      if (!rule.appliesTo(repoFilePath)) {
        continue
      }

      if (!rule.isViolation(repoFilePath, repoTargetPath)) {
        continue
      }

      violations.push({
        file: repoFilePath,
        import: entry.specifier,
        line: entry.line,
        reason: rule.message,
        rule: rule.name,
        target: repoTargetPath
      })
    }
  }
}

if (violations.length === 0) {
  console.log("architecture imports check passed")
  process.exit(0)
}

console.error(formatViolations("architecture imports check", violations))
process.exit(1)
