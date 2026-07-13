import { spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { isDeepStrictEqual } from "node:util"
import { stableDiagnosticId } from "./doctor-contracts.mjs"

const sourceFilePattern = /\.(tsx?|jsx?|mts|mjs)$/
const generatedBundlePattern = /\.(iife|umd|global|min)\.m?js$/i
const generatedSourceDirectoryPattern = /(?:^|\/)__generated__\//
const scannedDotDirectories = new Set([".dumi", ".storybook"])
const ignoredDirectories = new Set([
  ".angular",
  ".astro",
  ".cache",
  ".contentlayer",
  ".direnv",
  ".docusaurus",
  ".expo",
  ".firebase",
  ".git",
  ".gradle",
  ".hg",
  ".next",
  ".nuxt",
  ".nx",
  ".output",
  ".parcel-cache",
  ".serverless",
  ".svelte-kit",
  ".svn",
  ".terraform",
  ".turbo",
  ".venv",
  ".vercel",
  ".wrangler",
  ".yarn",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "storybook-static"
])
const minifiedSniffBytes = 65_536
const gitFilesMaxBufferBytes = 50 * 1024 * 1024

function isIgnoredDirectoryName(name) {
  return ignoredDirectories.has(name) || (name.startsWith(".") && !scannedDotDirectories.has(name))
}

function isEligibleSourcePath(filePath) {
  return (
    sourceFilePattern.test(filePath) &&
    !generatedBundlePattern.test(filePath) &&
    !generatedSourceDirectoryPattern.test(filePath) &&
    !filePath
      .split(/[/\\]/)
      .slice(0, -1)
      .some((segment) => isIgnoredDirectoryName(segment))
  )
}

function isLargeMinifiedFile(absolutePath) {
  let file
  try {
    if (fs.statSync(absolutePath).size < 20_000) {
      return false
    }
    file = fs.openSync(absolutePath, "r")
    const buffer = Buffer.alloc(minifiedSniffBytes)
    const bytesRead = fs.readSync(file, buffer, 0, buffer.length, 0)
    const source = buffer.toString("utf8", 0, bytesRead)
    const lines = source.split("\n")
    const longestLine = lines.reduce((longest, line) => Math.max(longest, line.length), 0)
    return longestLine > 1000 && source.length / lines.length > 500
  } catch {
    return false
  } finally {
    if (file !== undefined) {
      fs.closeSync(file)
    }
  }
}

function listSourceFilesFromFilesystem(rootDirectory) {
  const files = []
  const pending = [rootDirectory]
  while (pending.length > 0) {
    const directory = pending.pop()
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        if (!isIgnoredDirectoryName(entry.name)) {
          pending.push(absolutePath)
        }
      } else if (entry.isFile() && isEligibleSourcePath(entry.name)) {
        files.push(path.relative(rootDirectory, absolutePath).split(path.sep).join("/"))
      }
    }
  }
  return files
}

export function discoverReactDoctorEligibleSourceFiles(rootDirectory) {
  const result = spawnSync(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    {
      cwd: rootDirectory,
      encoding: "utf8",
      maxBuffer: gitFilesMaxBufferBytes
    }
  )
  const candidates =
    !result.error && result.status === 0
      ? result.stdout.split("\0").filter(Boolean)
      : listSourceFilesFromFilesystem(rootDirectory)
  // React Doctor 0.7.4 counts Git candidates, including tracked paths deleted in the worktree.
  return candidates
    .filter(isEligibleSourcePath)
    .filter((filePath) => !isLargeMinifiedFile(path.resolve(rootDirectory, filePath)))
    .sort()
}

function fail(message) {
  throw new Error(`react-doctor returned an invalid report: ${message}`)
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0
}

function isNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0
}

function isPositiveInteger(value) {
  return Number.isInteger(value) && value >= 1
}

function assertOptionalString(value, field) {
  if (value !== undefined && typeof value !== "string") {
    fail(`${field} must be a string when present`)
  }
}

function assertOptionalNonNegativeInteger(value, field) {
  if (value !== undefined && !isNonNegativeInteger(value)) {
    fail(`${field} must be a non-negative integer when present`)
  }
}

function assertOptionalPositiveInteger(value, field) {
  if (value !== undefined && !isPositiveInteger(value)) {
    fail(`${field} must be a positive integer when present`)
  }
}

function assertPathInsideDirectory(filePath, directory, field) {
  const absoluteFile = path.isAbsolute(filePath) ? filePath : path.resolve(directory, filePath)
  const relativeFile = path.relative(directory, absoluteFile)
  if (
    !relativeFile ||
    relativeFile === ".." ||
    relativeFile.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeFile)
  ) {
    fail(`${field} is outside the scanned directory: ${filePath}`)
  }
}

function validateRelatedLocation(location, diagnosticIndex, locationIndex, reportDirectory) {
  const field = `diagnostics[${diagnosticIndex}].relatedLocations[${locationIndex}]`
  if (!isObject(location)) {
    fail(`${field} must be an object`)
  }
  if (!isNonEmptyString(location.filePath)) {
    fail(`${field}.filePath must be a non-empty string`)
  }
  assertPathInsideDirectory(location.filePath, reportDirectory, `${field}.filePath`)
  if (typeof location.message !== "string") {
    fail(`${field}.message must be a string`)
  }
  if (!isNonNegativeInteger(location.line) || !isNonNegativeInteger(location.column)) {
    fail(`${field}.line and column must be non-negative integers`)
  }
  assertOptionalNonNegativeInteger(location.offset, `${field}.offset`)
  assertOptionalNonNegativeInteger(location.length, `${field}.length`)
  assertOptionalPositiveInteger(location.endLine, `${field}.endLine`)
  assertOptionalPositiveInteger(location.endColumn, `${field}.endColumn`)
}

function validateRawDiagnostic(raw, index, reportDirectory) {
  const field = `diagnostics[${index}]`
  if (!isObject(raw)) {
    fail(`${field} must be an object`)
  }
  for (const name of ["filePath", "plugin", "rule"]) {
    if (!isNonEmptyString(raw[name])) {
      fail(`${field}.${name} must be a non-empty string`)
    }
  }
  assertPathInsideDirectory(raw.filePath, reportDirectory, `${field}.filePath`)
  if (!new Set(["error", "warning"]).has(raw.severity)) {
    fail(`${field}.severity must be error or warning`)
  }
  if (!isNonEmptyString(raw.message) || !isNonEmptyString(raw.category)) {
    fail(`${field}.message and category must be non-empty strings`)
  }
  if (typeof raw.help !== "string") {
    fail(`${field}.help must be a string`)
  }
  if (!isNonNegativeInteger(raw.line) || !isNonNegativeInteger(raw.column)) {
    fail(`${field}.line and column must be non-negative integers`)
  }
  assertOptionalNonNegativeInteger(raw.offset, `${field}.offset`)
  assertOptionalNonNegativeInteger(raw.length, `${field}.length`)
  assertOptionalPositiveInteger(raw.endLine, `${field}.endLine`)
  assertOptionalPositiveInteger(raw.endColumn, `${field}.endColumn`)
  for (const name of ["title", "url", "suppressionHint", "fixGroupId"]) {
    assertOptionalString(raw[name], `${field}.${name}`)
  }
  if (raw.matchByOccurrence !== undefined && typeof raw.matchByOccurrence !== "boolean") {
    fail(`${field}.matchByOccurrence must be a boolean when present`)
  }
  if (raw.fileContext !== undefined && !new Set(["test", "story"]).has(raw.fileContext)) {
    fail(`${field}.fileContext must be test or story when present`)
  }
  if (raw.relatedLocations !== undefined) {
    if (!Array.isArray(raw.relatedLocations)) {
      fail(`${field}.relatedLocations must be an array when present`)
    }
    raw.relatedLocations.forEach((location, locationIndex) =>
      validateRelatedLocation(location, index, locationIndex, reportDirectory)
    )
  }
}

function validateSkippedCheckReasons(value, projectIndex) {
  if (value === undefined) {
    return
  }
  if (!isObject(value)) {
    fail(`projects[${projectIndex}].skippedCheckReasons must be an object when present`)
  }
  for (const [name, reason] of Object.entries(value)) {
    if (!isNonEmptyString(name) || typeof reason !== "string") {
      fail(`projects[${projectIndex}].skippedCheckReasons must be a string map`)
    }
  }
  if (Object.keys(value).length > 0) {
    fail(`projects[${projectIndex}] contains skipped check reasons`)
  }
}

export function validateReactDoctorRawReport({
  expectedDirectory,
  expectedSourceFileCount,
  expectedVersion,
  raw
}) {
  if (!isObject(raw)) {
    fail("top level must be an object")
  }
  if (
    raw.schemaVersion !== 1 ||
    raw.ok !== true ||
    raw.mode !== "full" ||
    raw.reactDetected !== true
  ) {
    fail("schemaVersion, ok, mode, or reactDetected does not match the full-scan contract")
  }
  if (raw.version !== expectedVersion) {
    fail(`version ${String(raw.version)} does not match installed ${expectedVersion}`)
  }
  if (!isNonEmptyString(raw.directory)) {
    fail("directory must be a non-empty string")
  }
  const reportDirectory = path.resolve(raw.directory)
  if (reportDirectory !== path.resolve(expectedDirectory)) {
    fail(`directory ${raw.directory} does not match ${expectedDirectory}`)
  }
  if (raw.diff !== null || raw.error !== null) {
    fail("full scans require diff and error to be null")
  }
  if (Object.hasOwn(raw, "baseline") || Object.hasOwn(raw, "baselineDegraded")) {
    fail("full scans cannot contain baseline state")
  }
  if (!Number.isFinite(raw.elapsedMilliseconds) || raw.elapsedMilliseconds < 0) {
    fail("elapsedMilliseconds must be a finite non-negative number")
  }
  if (!Array.isArray(raw.projects) || raw.projects.length !== 1) {
    fail("the renderer harness requires exactly one project")
  }
  if (!isPositiveInteger(expectedSourceFileCount)) {
    fail("the renderer harness requires a positive independent source file count")
  }
  if (!Array.isArray(raw.diagnostics)) {
    fail("diagnostics must be an array")
  }
  if (!isObject(raw.summary)) {
    fail("summary must be an object")
  }

  raw.diagnostics.forEach((diagnostic, index) =>
    validateRawDiagnostic(diagnostic, index, reportDirectory)
  )
  let scannedFileCount = 0
  const projectDiagnostics = []
  let computedReactDetected = false
  for (const [index, projectResult] of raw.projects.entries()) {
    const field = `projects[${index}]`
    if (!isObject(projectResult) || !isNonEmptyString(projectResult.directory)) {
      fail(`${field} and its directory must be valid`)
    }
    const projectDirectory = path.resolve(projectResult.directory)
    if (projectDirectory !== reportDirectory) {
      fail(`${field}.directory must match the scanned renderer directory`)
    }
    if (!isObject(projectResult.project)) {
      fail(`${field}.project must be an object`)
    }
    for (const name of ["reactVersion", "preactVersion"]) {
      const value = projectResult.project[name]
      if (value !== null && typeof value !== "string") {
        fail(`${field}.project.${name} must be a string or null`)
      }
    }
    computedReactDetected ||=
      projectResult.project.reactVersion !== null || projectResult.project.preactVersion !== null
    if (!isNonNegativeInteger(projectResult.project.sourceFileCount)) {
      fail(`${field}.project.sourceFileCount must be a non-negative integer`)
    }
    if (!isNonNegativeInteger(projectResult.scannedFileCount)) {
      fail(`${field}.scannedFileCount must be a non-negative integer`)
    }
    if (projectResult.scannedFileCount > projectResult.project.sourceFileCount) {
      fail(`${field}.scannedFileCount exceeds sourceFileCount`)
    }
    if (projectResult.scannedFileCount !== projectResult.project.sourceFileCount) {
      fail(`${field}.scannedFileCount must equal sourceFileCount for a full scan`)
    }
    if (
      !Number.isFinite(projectResult.elapsedMilliseconds) ||
      projectResult.elapsedMilliseconds < 0
    ) {
      fail(`${field}.elapsedMilliseconds must be a finite non-negative number`)
    }
    if (!Array.isArray(projectResult.diagnostics)) {
      fail(`${field}.diagnostics must be an array`)
    }
    if (
      !Array.isArray(projectResult.skippedChecks) ||
      projectResult.skippedChecks.some((entry) => typeof entry !== "string")
    ) {
      fail(`${field}.skippedChecks must be a string array`)
    }
    if (projectResult.skippedChecks.length > 0) {
      fail(`${field} contains skipped checks`)
    }
    validateSkippedCheckReasons(projectResult.skippedCheckReasons, index)
    scannedFileCount += projectResult.scannedFileCount
    projectDiagnostics.push(...projectResult.diagnostics)
  }
  if (!computedReactDetected || computedReactDetected !== raw.reactDetected) {
    fail("reactDetected does not match project runtime metadata")
  }
  if (scannedFileCount <= 0) {
    fail("projects reported zero scanned files")
  }
  if (scannedFileCount !== expectedSourceFileCount) {
    fail(
      `React Doctor scanned ${scannedFileCount} files; independent discovery found ${expectedSourceFileCount}`
    )
  }
  if (!isDeepStrictEqual(raw.diagnostics, projectDiagnostics)) {
    fail("top-level diagnostics do not match project diagnostics")
  }

  for (const name of ["errorCount", "warningCount", "affectedFileCount", "totalDiagnosticCount"]) {
    if (!isNonNegativeInteger(raw.summary[name])) {
      fail(`summary.${name} must be a non-negative integer`)
    }
  }
  if (raw.summary.score !== null && !Number.isFinite(raw.summary.score)) {
    fail("summary.score must be a finite number or null")
  }
  if (raw.summary.scoreLabel !== null && typeof raw.summary.scoreLabel !== "string") {
    fail("summary.scoreLabel must be a string or null")
  }
  const errorCount = raw.diagnostics.filter((diagnostic) => diagnostic.severity === "error").length
  const warningCount = raw.diagnostics.length - errorCount
  const affectedFileCount = new Set(raw.diagnostics.map((diagnostic) => diagnostic.filePath)).size
  if (
    raw.summary.totalDiagnosticCount !== raw.diagnostics.length ||
    raw.summary.errorCount !== errorCount ||
    raw.summary.warningCount !== warningCount ||
    raw.summary.errorCount + raw.summary.warningCount !== raw.summary.totalDiagnosticCount ||
    raw.summary.affectedFileCount !== affectedFileCount
  ) {
    fail("summary counts do not match diagnostics")
  }

  return {
    intendedSourceFileCount: expectedSourceFileCount,
    projectCount: raw.projects.length,
    scannedFileCount
  }
}

export function normalizeReactDiagnostics({ rawDiagnostics, reportDirectory, repoRoot }) {
  const diagnosticsByIdentity = new Map()
  for (const [index, raw] of rawDiagnostics.entries()) {
    validateRawDiagnostic(raw, index, path.resolve(reportDirectory))
    const rawFilePath = raw.filePath
    const absoluteFile = path.isAbsolute(rawFilePath)
      ? rawFilePath
      : path.resolve(reportDirectory, rawFilePath)
    const file = path.relative(repoRoot, absoluteFile).split(path.sep).join("/")
    const plugin = raw.plugin
    const identity = [
      "react-doctor",
      plugin,
      raw.rule,
      file,
      raw.severity,
      raw.category,
      raw.fixGroupId ?? "",
      raw.title ?? "",
      raw.message,
      raw.help
    ]
    const identityKey = identity.join("\0")
    let diagnostic = diagnosticsByIdentity.get(identityKey)
    if (!diagnostic) {
      diagnostic = {
        diagnosticId: stableDiagnosticId(identity),
        source: "react-doctor",
        plugin,
        ruleId: raw.rule,
        severity: raw.severity,
        category: raw.category,
        file,
        line: raw.line,
        column: raw.column,
        occurrenceCount: 0,
        locations: [],
        title: raw.title ?? null,
        message: raw.message,
        help: raw.help,
        fixGroupId: raw.fixGroupId ?? null
      }
      diagnosticsByIdentity.set(identityKey, diagnostic)
    }
    diagnostic.locations.push({
      line: raw.line,
      column: raw.column,
      offset: raw.offset ?? null,
      length: raw.length ?? null
    })
    diagnostic.occurrenceCount += 1
  }

  return [...diagnosticsByIdentity.values()]
    .map((diagnostic) => {
      diagnostic.locations.sort(
        (left, right) => left.line - right.line || left.column - right.column
      )
      diagnostic.line = diagnostic.locations[0].line
      diagnostic.column = diagnostic.locations[0].column
      return diagnostic
    })
    .sort(
      (left, right) =>
        left.plugin.localeCompare(right.plugin) ||
        left.ruleId.localeCompare(right.ruleId) ||
        left.file.localeCompare(right.file) ||
        left.line - right.line
    )
}
