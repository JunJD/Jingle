import assert from "node:assert/strict"
import test from "node:test"
import { createElement } from "react"
import { List } from "@openwork/extension-api"
import { createExtensionRuntimeRenderer } from "../../src/extension-runtime/reconciler/render"
import { githubManifest } from "../../extensions/github/manifest"
import { getNativeExtensionRuntimeCommand } from "../../src/extensions/runtime"
import {
  getIssueLikeAccessories,
  getRepositoryAccessories,
  getWorkflowRunAccessories
} from "../../extensions/github/src/view-helpers"
import type {
  GitHubIssueLike,
  GitHubRepository,
  GitHubWorkflowRun
} from "../../extensions/github/domain/client-core"

const GITHUB_RUNTIME_VIEW_COMMANDS = [
  "create-issue",
  "create-pull-request",
  "my-issues",
  "my-latest-repositories",
  "my-pull-requests",
  "my-starred-repositories",
  "notifications",
  "search-issues",
  "search-pull-requests",
  "search-repositories",
  "workflow-runs"
]

test("GitHub runtime commands declare manifest metadata and registry entries", () => {
  const githubRuntimeCommands = githubManifest.commands
    .filter((command) => command.mode !== "background" && command.runtime)
    .map((command) => command.name)
    .sort()
  const expectedRuntimeCommands = [...GITHUB_RUNTIME_VIEW_COMMANDS, "unread-notifications"]

  assert.deepEqual(githubRuntimeCommands, expectedRuntimeCommands.sort())
  for (const commandName of expectedRuntimeCommands) {
    assert.ok(
      getNativeExtensionRuntimeCommand({
        commandName,
        extensionName: "github"
      })
    )
  }
})

test("GitHub runtime accessories serialize as stable text visuals", async () => {
  const issueAccessories = getIssueLikeAccessories(createIssueLike())
  const repositoryAccessories = getRepositoryAccessories(createRepository(), true)
  const workflowAccessories = getWorkflowRunAccessories(createWorkflowRun())

  assert.equal(issueAccessories, "openwork/runtime · 3 comments · Draft")
  assert.equal(repositoryAccessories, "JunJD · TypeScript · 42 stars · 7 forks · Private")
  assert.equal(workflowAccessories, "main · abc1234 · #12")

  const renderer = createExtensionRuntimeRenderer({
    commandName: "my-issues",
    extensionName: "github"
  })
  renderer.render(
    createElement(
      List,
      null,
      createElement(List.Item, {
        accessories: issueAccessories,
        id: "issue-1",
        title: "Runtime migration"
      })
    )
  )
  await renderer.flushSnapshots()

  const snapshot = renderer.getSnapshot()
  assert.equal(snapshot?.kind, "list")
  if (snapshot?.kind !== "list") {
    return
  }

  assert.deepEqual(snapshot.sections[0]?.items[0]?.accessories, [
    {
      kind: "text",
      text: "openwork/runtime · 3 comments · Draft"
    }
  ])
})

function createIssueLike(): GitHubIssueLike {
  return {
    comments: 3,
    id: 1,
    isDraft: true,
    kind: "pull_request",
    number: 12,
    repositoryName: "openwork/runtime",
    state: "open",
    title: "Runtime migration",
    updatedAt: "2026-04-29T00:00:00.000Z",
    url: "https://github.com/JunJD/Jingle/pull/12"
  }
}

function createRepository(): GitHubRepository {
  return {
    description: "Launcher runtime",
    forks: 7,
    fullName: "JunJD/Jingle",
    id: 2,
    isArchived: false,
    isFork: false,
    isPrivate: true,
    language: "TypeScript",
    ownerAvatarUrl: "",
    ownerLogin: "JunJD",
    stars: 42,
    updatedAt: "2026-04-29T00:00:00.000Z",
    url: "https://github.com/JunJD/Jingle"
  }
}

function createWorkflowRun(): GitHubWorkflowRun {
  return {
    conclusion: "success",
    createdAt: "2026-04-29T00:00:00.000Z",
    event: "push",
    headBranch: "main",
    headCommitAuthor: "JunJD",
    headCommitMessage: "Runtime migration",
    headSha: "abc123456789",
    id: 3,
    name: "CI",
    repositoryFullName: "JunJD/Jingle",
    runNumber: 12,
    status: "completed",
    updatedAt: "2026-04-29T00:00:00.000Z",
    url: "https://github.com/JunJD/Jingle/actions/runs/3"
  }
}
