import { execFileSync, spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import process from "node:process"
import {
  assertDoctorDependencyClosure,
  computeDoctorContractSnapshot,
  computeRendererGitIndexDigest,
  doctorSchemaVersion,
  loadCaseCatalog,
  readGitHead,
  requiredReactDoctorVersion,
  summarizeDiagnostics,
  writeJson
} from "./doctor-contracts.mjs"
import { computeRendererDigest, runJingleFrontendDoctor } from "./doctor-frontend.mjs"
import { acquireDoctorLock, assertDoctorLockHeld, releaseDoctorLock } from "./doctor-lock.mjs"
import {
  discoverReactDoctorEligibleSourceFiles,
  normalizeReactDiagnostics,
  validateReactDoctorRawReport
} from "./doctor-react-report.mjs"

const repoRoot = process.cwd()
const reportsRoot = path.join(repoRoot, ".jingle-doctor/reports")
const lockPath = path.join(reportsRoot, ".lock")
const runId = new Date().toISOString().replace(/[-:.]/g, "").replace("Z", "Z")
const nextDirectory = path.join(reportsRoot, `.next-${runId}-${process.pid}`)
const latestDirectory = path.join(reportsRoot, "latest")
const previousDirectory = path.join(reportsRoot, `.previous-${runId}-${process.pid}`)
const executionErrors = []
const reactDoctorMaxDurationSeconds = 20 * 60

let lock

function gitValue(args, fallback) {
  try {
    return execFileSync("git", args, { cwd: repoRoot, encoding: "utf8" }).trim() || fallback
  } catch {
    return fallback
  }
}

function readPackageVersion(packageName) {
  const packagePath = path.join(repoRoot, "node_modules", packageName, "package.json")
  return JSON.parse(fs.readFileSync(packagePath, "utf8")).version
}

function runReactDoctor(reportPath, expectedSourceFileCount) {
  const binaryPath = path.join(repoRoot, "node_modules/react-doctor/bin/react-doctor.js")
  if (!fs.existsSync(binaryPath)) {
    throw new Error(
      "Pinned react-doctor is missing; run pnpm install. No unpinned fallback is allowed."
    )
  }

  const result = spawnSync(
    process.execPath,
    [
      binaryPath,
      "src/renderer/src",
      "--yes",
      "--scope",
      "full",
      "--lint",
      "--dead-code",
      "--warnings",
      "--max-duration",
      String(reactDoctorMaxDurationSeconds),
      "--json",
      "--json-compact",
      "--json-out",
      reportPath,
      "--no-telemetry",
      "--no-supply-chain",
      "--no-respect-inline-disables",
      "--blocking",
      "none",
      "--no-color"
    ],
    {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        NO_COLOR: "1",
        REACT_DOCTOR_NO_CACHE: "1"
      },
      maxBuffer: 64 * 1024 * 1024,
      timeout: (reactDoctorMaxDurationSeconds + 60) * 1000
    }
  )

  if (result.error) {
    throw result.error
  }
  if (result.status !== 0) {
    throw new Error(
      `react-doctor exited ${result.status}: ${(result.stderr || result.stdout || "no output").trim()}`
    )
  }
  if (!fs.existsSync(reportPath)) {
    throw new Error("react-doctor completed without writing its JSON report")
  }
  const raw = JSON.parse(fs.readFileSync(reportPath, "utf8"))
  const expectedDirectory = path.resolve(repoRoot, "src/renderer/src")
  const installedVersion = readPackageVersion("react-doctor")
  if (installedVersion !== requiredReactDoctorVersion) {
    throw new Error(
      `react-doctor ${installedVersion} is installed; Doctor requires ${requiredReactDoctorVersion}`
    )
  }
  const rawCoverage = validateReactDoctorRawReport({
    expectedDirectory,
    expectedSourceFileCount,
    expectedVersion: requiredReactDoctorVersion,
    raw
  })

  const diagnostics = normalizeReactDiagnostics({
    rawDiagnostics: raw.diagnostics,
    reportDirectory: raw.directory,
    repoRoot
  })

  return {
    schemaVersion: doctorSchemaVersion,
    runId,
    source: "react-doctor",
    toolVersion: raw.version,
    status: "complete",
    target: "src/renderer/src",
    coverage: {
      reactDetected: raw.reactDetected,
      intendedSourceFileCount: rawCoverage.intendedSourceFileCount,
      projectCount: rawCoverage.projectCount,
      scannedFileCountReportedByTool: rawCoverage.scannedFileCount,
      skippedChecks: []
    },
    elapsedMilliseconds: raw.elapsedMilliseconds,
    diagnostics
  }
}

function incompleteReactReport(message) {
  return {
    schemaVersion: doctorSchemaVersion,
    runId,
    source: "react-doctor",
    toolVersion: fs.existsSync(path.join(repoRoot, "node_modules/react-doctor/package.json"))
      ? readPackageVersion("react-doctor")
      : null,
    status: "incomplete",
    target: "src/renderer/src",
    coverage: {
      reactDetected: false,
      intendedSourceFileCount: 0,
      projectCount: 0,
      scannedFileCountReportedByTool: 0,
      skippedChecks: []
    },
    diagnostics: [],
    error: message
  }
}

function findDuplicateDiagnosticIds(report) {
  const seen = new Set()
  const duplicates = new Set()
  for (const diagnostic of report.diagnostics) {
    if (seen.has(diagnostic.diagnosticId)) {
      duplicates.add(diagnostic.diagnosticId)
    }
    seen.add(diagnostic.diagnosticId)
  }
  return [...duplicates].sort()
}

function publishLatest() {
  let movedPrevious = false
  try {
    if (fs.existsSync(latestDirectory)) {
      fs.renameSync(latestDirectory, previousDirectory)
      movedPrevious = true
    }
    fs.renameSync(nextDirectory, latestDirectory)
    if (movedPrevious) {
      fs.rmSync(previousDirectory, { recursive: true, force: true })
    }
  } catch (error) {
    if (!fs.existsSync(latestDirectory) && movedPrevious && fs.existsSync(previousDirectory)) {
      fs.renameSync(previousDirectory, latestDirectory)
    }
    throw error
  }
}

fs.mkdirSync(reportsRoot, { recursive: true })
try {
  lock = await acquireDoctorLock(lockPath)
} catch (error) {
  console.error(`Jingle Doctor could not acquire its report lock: ${lockPath}`)
  console.error(String(error))
  process.exit(2)
}

try {
  fs.mkdirSync(nextDirectory, { recursive: true })
  assertDoctorLockHeld(lock)
  assertDoctorDependencyClosure(repoRoot)
  const catalog = loadCaseCatalog(repoRoot)
  const beforeDigest = computeRendererDigest(repoRoot)
  const beforeContract = computeDoctorContractSnapshot(repoRoot)
  const beforeHead = readGitHead(repoRoot)
  const beforeIndexDigest = computeRendererGitIndexDigest(repoRoot)
  const input = {
    head: beforeHead,
    branch: gitValue(["branch", "--show-current"], "detached"),
    dirty: gitValue(["status", "--porcelain=v1"], "").length > 0,
    rendererDigest: beforeDigest,
    doctorContractDigest: beforeContract.digest,
    doctorContractManifestVersion: beforeContract.manifestVersion,
    doctorContractFileCount: beforeContract.contentFileCount,
    doctorContractTopologyEntryCount: beforeContract.topologyEntryCount,
    doctorToolVersions: beforeContract.toolVersions,
    rendererGitIndexDigest: beforeIndexDigest
  }

  let jingleReport
  try {
    assertDoctorLockHeld(lock)
    jingleReport = runJingleFrontendDoctor({ catalog, repoRoot, runId })
    if (jingleReport.status !== "complete") {
      executionErrors.push({
        source: "jingle-doctor",
        code: "parse_failure",
        message: `${jingleReport.parseFailures.length} renderer file(s) could not be parsed`,
        details: jingleReport.parseFailures
      })
    }
  } catch (error) {
    executionErrors.push({
      source: "jingle-doctor",
      code: "scanner_failure",
      message: String(error)
    })
    jingleReport = {
      schemaVersion: doctorSchemaVersion,
      runId,
      source: "jingle-doctor",
      status: "incomplete",
      target: "src/renderer/src",
      coverage: {},
      ruleCoverage: [],
      parseFailures: [],
      diagnostics: []
    }
  }

  const rawReactReportPath = path.join(nextDirectory, ".react-doctor.raw.json")
  let reactReport
  try {
    assertDoctorLockHeld(lock)
    const reactSourceFiles = discoverReactDoctorEligibleSourceFiles(
      path.resolve(repoRoot, "src/renderer/src")
    )
    reactReport = runReactDoctor(rawReactReportPath, reactSourceFiles.length)
  } catch (error) {
    executionErrors.push({
      source: "react-doctor",
      code: "scanner_failure",
      message: String(error)
    })
    reactReport = incompleteReactReport(String(error))
  } finally {
    fs.rmSync(rawReactReportPath, { force: true })
  }

  assertDoctorLockHeld(lock)

  for (const report of [jingleReport, reactReport]) {
    const duplicateIds = findDuplicateDiagnosticIds(report)
    if (duplicateIds.length > 0) {
      executionErrors.push({
        source: report.source,
        code: "duplicate_diagnostic_id",
        message: `Diagnostic IDs are not unique: ${duplicateIds.join(", ")}`
      })
    }
  }

  const afterDigest = computeRendererDigest(repoRoot)
  const afterContract = computeDoctorContractSnapshot(repoRoot)
  const afterHead = readGitHead(repoRoot)
  const afterIndexDigest = computeRendererGitIndexDigest(repoRoot)
  if (afterDigest !== beforeDigest) {
    executionErrors.push({
      source: "jingle-doctor",
      code: "worktree_changed_during_scan",
      message: "Renderer inputs changed while Doctor was running; rerun for a coherent report."
    })
  }
  if (afterContract.digest !== beforeContract.digest) {
    executionErrors.push({
      source: "jingle-doctor",
      code: "doctor_contract_changed_during_scan",
      message:
        "Doctor cases or scanner inputs changed while Doctor was running; rerun for a coherent report."
    })
  }
  if (afterHead !== beforeHead || afterIndexDigest !== beforeIndexDigest) {
    executionErrors.push({
      source: "jingle-doctor",
      code: "git_state_changed_during_scan",
      message:
        "Git HEAD or the renderer index changed while Doctor was running; rerun for a coherent report."
    })
  }

  const summary = summarizeDiagnostics({ executionErrors, input, jingleReport, reactReport, runId })
  assertDoctorLockHeld(lock)
  writeJson(path.join(nextDirectory, "jingle-doctor.json"), jingleReport)
  writeJson(path.join(nextDirectory, "react-doctor.json"), reactReport)
  writeJson(path.join(nextDirectory, "summary.json"), summary)
  publishLatest()

  console.log("Jingle Doctor")
  console.log(`status: ${summary.status}`)
  console.log(
    `coverage: ${jingleReport.coverage.scannedSourceFileCount ?? 0}/${jingleReport.coverage.discoveredSourceFileCount ?? 0} source, ${jingleReport.coverage.scannedStyleFileCount ?? 0}/${jingleReport.coverage.discoveredStyleFileCount ?? 0} styles, ${jingleReport.coverage.implementedCaseCount ?? 0}/${jingleReport.coverage.catalogCaseCount ?? 0} cases`
  )
  console.log(
    `findings: ${summary.counts.blocking} blocking diagnostics (${summary.counts.occurrences} occurrences) in ${summary.counts.groups} group${summary.counts.groups === 1 ? "" : "s"}`
  )
  for (const group of summary.groups) {
    console.log(
      `- ${group.groupId}: ${group.count} diagnostic${group.count === 1 ? "" : "s"} / ${group.occurrences} occurrence${group.occurrences === 1 ? "" : "s"} in ${group.affectedFileCount} file${group.affectedFileCount === 1 ? "" : "s"}`
    )
  }
  for (const error of summary.executionErrors) {
    console.log(`- execution/${error.code}: ${error.message}`)
  }
  console.log("report: .jingle-doctor/reports/latest/summary.json")

  process.exitCode = summary.status === "incomplete" ? 2 : summary.clean ? 0 : 1
} catch (error) {
  console.error("Jingle Doctor could not produce a report")
  console.error(error)
  process.exitCode = 2
} finally {
  fs.rmSync(nextDirectory, { recursive: true, force: true })
  if (lock !== undefined) {
    await releaseDoctorLock(lock)
  }
}
