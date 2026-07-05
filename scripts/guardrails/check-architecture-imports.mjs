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
      isUnder(target, "extensions/") ||
      isUnder(target, "src/plugins/"),
    message: "shared 层不能依赖 renderer/main/preload/extensions/plugins"
  },
  {
    name: "extension-authoring-boundary",
    appliesTo: (file) =>
      (isUnder(file, "src/extensions/") || isUnder(file, "extensions/")) &&
      !file.includes("/main/"),
    isViolation: (_, target) =>
      isUnder(target, "src/renderer/") ||
      isUnder(target, "src/main/") ||
      isUnder(target, "src/preload/") ||
      isUnder(target, "src/plugins/"),
    message: "extension 运行时代码只能通过 @jingle/extension-api 和 shared/* 接宿主能力"
  },
  {
    name: "public-extension-package-boundary",
    appliesTo: (file) =>
      isUnder(file, "packages/extension-api/src/") ||
      isUnder(file, "packages/extension-utils/src/"),
    isViolation: (_, target) =>
      isUnder(target, "src/") ||
      isUnder(target, "extensions/") ||
      isUnder(target, "packages/extension-migration/"),
    message: "public extension packages 必须拥有自己的实现/contract，不能反向 import 宿主 src、extension 包或 migration 包"
  },
  {
    name: "renderer-extension-catalog-projection-boundary",
    appliesTo: (file) => isUnder(file, "src/renderer/"),
    isViolation: (_, _target, specifier) => specifier.startsWith("@extensions/"),
    message:
      "renderer launcher 只能通过 main/preload 暴露的 catalog projection 读取 extension registry，不能 import @extensions/* 静态表"
  }
]

const violations = []

for (const absoluteFilePath of [
  ...listSourceFiles(srcRoot),
  ...listSourceFiles(path.join(process.cwd(), "extensions")),
  ...listSourceFiles(path.join(process.cwd(), "packages", "extension-api", "src")),
  ...listSourceFiles(path.join(process.cwd(), "packages", "extension-utils", "src"))
]) {
  const repoFilePath = toRepoPath(absoluteFilePath)
  if (
    isUnder(repoFilePath, "src/extension-runtime/sdk/") ||
    isExact(repoFilePath, "src/extensions/runtime-api.ts") ||
    isExact(repoFilePath, "src/extensions/runtime-contract.ts") ||
    isExact(repoFilePath, "src/extensions/runtime-metadata-contract.ts")
  ) {
    violations.push({
      file: repoFilePath,
      reason:
        "旧 extension SDK/runtime contract 入口已删除；请使用 @jingle/extension-api 或 @jingle/extension-api/host-runtime",
      rule: "no-legacy-extension-sdk-entry"
    })
  }

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

      if (!rule.isViolation(repoFilePath, repoTargetPath, entry.specifier)) {
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
