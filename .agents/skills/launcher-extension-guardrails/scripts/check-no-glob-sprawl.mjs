import {
  allowedImportMetaGlobFiles,
  formatViolations,
  listSourceFiles,
  readSourceText,
  srcRoot,
  toRepoPath
} from "./lib/architecture-guardrails.mjs"

const violations = []

for (const absoluteFilePath of listSourceFiles(srcRoot)) {
  const repoFilePath = toRepoPath(absoluteFilePath)
  const sourceText = readSourceText(repoFilePath)

  if (!sourceText.includes("import.meta.glob")) {
    continue
  }

  if (allowedImportMetaGlobFiles.has(repoFilePath)) {
    continue
  }

  violations.push({
    file: repoFilePath,
    reason:
      "新的 import.meta.glob 会让 extension 发现机制继续扩散；请收口到显式 registry 或既有 registry 文件"
  })
}

if (violations.length === 0) {
  console.log("no glob sprawl check passed")
  process.exit(0)
}

console.error(formatViolations("no glob sprawl check", violations))
process.exit(1)
