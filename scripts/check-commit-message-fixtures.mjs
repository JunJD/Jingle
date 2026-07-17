import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { shouldSkipCommitlint } from "./check-commit-messages.mjs"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const validator = path.join(repoRoot, "scripts", "check-commit-messages.mjs")

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    encoding: "utf8",
    input: options.input
  })
  if (result.error) throw result.error
  return result
}

function requireSuccess(result, label) {
  if (result.status !== 0) {
    throw new Error(`${label} failed:\n${result.stdout}${result.stderr}`)
  }
}

function git(repository, args) {
  const result = run("git", args, { cwd: repository })
  requireSuccess(result, `git ${args.join(" ")}`)
  return result.stdout.trim()
}

function expectValidator(label, args, expectedStatus, input) {
  const result = run(process.execPath, [validator, ...args], { input })
  if (result.status !== expectedStatus) {
    throw new Error(
      `${label}: expected ${expectedStatus}, received ${result.status}\n${result.stdout}${result.stderr}`
    )
  }
  process.stdout.write(`PASS expected=${expectedStatus} ${label}\n`)
}

const fixtureRepo = fs.mkdtempSync(path.join(os.tmpdir(), "jingle-commit-merge-fixture-"))

try {
  assert.equal(
    shouldSkipCommitlint({ message: "arbitrary merge subject", parentCount: 2 }),
    false,
    "parent topology alone must not bypass commitlint"
  )
  assert.equal(
    shouldSkipCommitlint({ message: "arbitrary merge subject", mergeInProgress: true }),
    false,
    "MERGE_HEAD alone must not bypass commitlint"
  )
  process.stdout.write("PASS topology and Merge subject are both required\n")

  requireSuccess(run("git", ["init", "--quiet", "--initial-branch=main", fixtureRepo]), "git init")
  git(fixtureRepo, ["config", "user.name", "Jingle Fixture"])
  git(fixtureRepo, ["config", "user.email", "fixture@jingle.invalid"])
  git(fixtureRepo, ["commit", "--quiet", "--allow-empty", "-m", "chore(repo): 建立提交校验基线"])
  const baselineCommit = git(fixtureRepo, ["rev-parse", "HEAD"])

  git(fixtureRepo, ["checkout", "--quiet", "-b", "feature"])
  git(fixtureRepo, ["commit", "--quiet", "--allow-empty", "-m", "fix(runtime): 保留恢复状态"])
  git(fixtureRepo, ["checkout", "--quiet", "main"])
  git(fixtureRepo, ["commit", "--quiet", "--allow-empty", "-m", "docs(repo): 记录合并校验"])

  git(fixtureRepo, ["merge", "--quiet", "--no-ff", "--no-commit", "feature"])
  const mergeMessageFile = path.join(fixtureRepo, "merge-message.txt")
  fs.writeFileSync(mergeMessageFile, "Merge branch 'feature'\n")
  expectValidator(
    "local MERGE_HEAD accepts generated merge subject",
    ["--repository", fixtureRepo, "--edit", mergeMessageFile],
    0
  )

  git(fixtureRepo, ["commit", "--quiet", "--no-verify", "-m", "Merge branch 'feature'"])
  const mergeCommit = git(fixtureRepo, ["rev-parse", "HEAD"])
  expectValidator(
    "two-parent merge commit is accepted",
    ["--repository", fixtureRepo, "--commit", mergeCommit],
    0
  )
  expectValidator(
    "CI range accepts a real merge commit",
    ["--repository", fixtureRepo, "--from", baselineCommit, "--to", mergeCommit],
    0
  )

  git(fixtureRepo, [
    "commit",
    "--quiet",
    "--allow-empty",
    "--no-verify",
    "-m",
    "Merge arbitrary single-parent subject"
  ])
  const syntheticMergeCommit = git(fixtureRepo, ["rev-parse", "HEAD"])
  expectValidator(
    "single-parent Merge subject is rejected",
    ["--repository", fixtureRepo, "--commit", syntheticMergeCommit],
    1
  )
  expectValidator(
    "CI range rejects a single-parent Merge subject",
    ["--repository", fixtureRepo, "--from", baselineCommit, "--to", syntheticMergeCommit],
    1
  )
  expectValidator("stdin Merge subject is rejected", [], 1, "Merge arbitrary stdin subject\n")
} finally {
  fs.rmSync(fixtureRepo, { recursive: true, force: true })
}
