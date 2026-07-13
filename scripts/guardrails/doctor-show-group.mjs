import fs from "node:fs"
import path from "node:path"
import process from "node:process"
import {
  computeDoctorContractDigest,
  computeRendererGitIndexDigest,
  readGitHead
} from "./doctor-contracts.mjs"
import { computeRendererDigest } from "./doctor-frontend.mjs"

const argumentsList = process.argv.slice(2)
const groupId = argumentsList.find((argument) => !argument.startsWith("--"))
const allowStale = argumentsList.includes("--allow-stale")
if (!groupId) {
  console.error("usage: node scripts/guardrails/doctor-show-group.mjs <group-id> [--allow-stale]")
  process.exit(2)
}

const repoRoot = process.cwd()
const reportsRoot = path.join(repoRoot, ".jingle-doctor/reports/latest")
const summaryPath = path.join(reportsRoot, "summary.json")
if (!fs.existsSync(summaryPath)) {
  console.error("Doctor summary is missing; run make doctor first.")
  process.exit(2)
}

const summary = JSON.parse(fs.readFileSync(summaryPath, "utf8"))
function findStaleInputs() {
  const staleInputs = []
  if (computeRendererDigest(repoRoot) !== summary.input?.rendererDigest) {
    staleInputs.push("renderer")
  }
  try {
    if (computeDoctorContractDigest(repoRoot) !== summary.input?.doctorContractDigest) {
      staleInputs.push("doctor contract")
    }
  } catch (error) {
    staleInputs.push(`doctor contract unavailable: ${String(error)}`)
  }
  if (readGitHead(repoRoot) !== summary.input?.head) {
    staleInputs.push("git HEAD")
  }
  if (computeRendererGitIndexDigest(repoRoot) !== summary.input?.rendererGitIndexDigest) {
    staleInputs.push("renderer git index")
  }
  return staleInputs
}

if (!allowStale) {
  const staleInputs = findStaleInputs()
  if (staleInputs.length > 0) {
    console.error(`Doctor report is stale (${staleInputs.join(", ")}); run make doctor first.`)
    process.exit(2)
  }
}
const group = summary.groups.find((entry) => entry.groupId === groupId)
if (!group) {
  console.error(`Doctor group not found: ${groupId}`)
  console.error(`available: ${summary.groups.map((entry) => entry.groupId).join(", ") || "none"}`)
  process.exit(2)
}

const reportName = group.source === "jingle-doctor" ? "jingle-doctor.json" : "react-doctor.json"
const report = JSON.parse(fs.readFileSync(path.join(reportsRoot, reportName), "utf8"))
if (report.runId !== summary.runId) {
  console.error("Doctor reports changed during review; rerun the group command.")
  process.exit(2)
}
const diagnostics = report.diagnostics.filter((diagnostic) =>
  group.source === "jingle-doctor"
    ? diagnostic.caseId === group.caseId
    : diagnostic.plugin === group.plugin && diagnostic.ruleId === group.ruleId
)
if (diagnostics.length !== group.count) {
  console.error(
    `Doctor group/report mismatch: summary=${group.count}, diagnostics=${diagnostics.length}`
  )
  process.exit(2)
}
const occurrenceCount = diagnostics.reduce(
  (total, diagnostic) => total + (diagnostic.occurrenceCount ?? 1),
  0
)
if (occurrenceCount !== group.occurrences) {
  console.error(
    `Doctor occurrence mismatch: summary=${group.occurrences}, diagnostics=${occurrenceCount}`
  )
  process.exit(2)
}
const publishedSummary = JSON.parse(fs.readFileSync(summaryPath, "utf8"))
if (publishedSummary.runId !== summary.runId) {
  console.error("Doctor reports changed during review; rerun the group command.")
  process.exit(2)
}
if (!allowStale) {
  const staleInputs = findStaleInputs()
  if (staleInputs.length > 0) {
    console.error(
      `Doctor inputs changed during review (${staleInputs.join(", ")}); rerun make doctor.`
    )
    process.exit(2)
  }
}

console.log(
  JSON.stringify(
    {
      schemaVersion: summary.schemaVersion,
      runId: summary.runId,
      status: summary.status,
      group,
      diagnostics
    },
    null,
    2
  )
)
