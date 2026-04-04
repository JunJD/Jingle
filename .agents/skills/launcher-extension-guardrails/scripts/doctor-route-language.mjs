import {
  listSourceFiles,
  readSourceText,
  srcRoot,
  toRepoPath
} from "./lib/architecture-guardrails.mjs"

const watchPrefixes = [
  "src/extensions/",
  "src/shared/native-extensions.ts",
  "src/renderer/src/launcher/native-extensions/",
  "src/renderer/src/launcher/pages/",
  "src/renderer/src/launcher/built-plugins/"
]

const watchTerms = ["internal-plugin", "pluginId", "LauncherPlugin", "builtLauncherPlugins"]

const findings = []

for (const absoluteFilePath of listSourceFiles(srcRoot)) {
  const repoFilePath = toRepoPath(absoluteFilePath)
  if (!watchPrefixes.some((prefix) => repoFilePath.startsWith(prefix))) {
    continue
  }

  const sourceText = readSourceText(repoFilePath)
  const matchedTerms = watchTerms
    .map((term) => ({ count: countOccurrences(sourceText, term), term }))
    .filter((entry) => entry.count > 0)

  if (matchedTerms.length === 0) {
    continue
  }

  findings.push({
    file: repoFilePath,
    terms: matchedTerms
  })
}

const totalMatches = findings.reduce(
  (sum, finding) => sum + finding.terms.reduce((termSum, entry) => termSum + entry.count, 0),
  0
)

console.log("route language doctor")
console.log("")
console.log(`watched files with legacy route language: ${findings.length}`)
console.log(`total matches: ${totalMatches}`)

if (findings.length > 0) {
  console.log("")
  for (const finding of findings.slice(0, 20)) {
    const summary = finding.terms.map((entry) => `${entry.term} x${entry.count}`).join(", ")
    console.log(`${finding.file}`)
    console.log(`  ${summary}`)
  }
}

console.log("")
console.log("goal: extension-command-first language should replace plugin-first language over time")

function countOccurrences(sourceText, term) {
  return sourceText.split(term).length - 1
}
