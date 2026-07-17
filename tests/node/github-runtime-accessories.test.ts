import assert from "node:assert/strict"
import test from "node:test"
import { createElement } from "react"
import { List } from "@jingle/extension-api"
import {
  ExtensionRuntimeNavigationProvider,
  type ExtensionRuntimeHostContextValue
} from "@jingle/extension-api/host-runtime"
import { createExtensionRuntimeRenderer } from "../../src/extension-runtime/reconciler/render"
import GitHubSearchRepositories from "../../installable-extensions/github/src/search-repositories"
import { githubManifest } from "../../installable-extensions/github/manifest"
import { githubRuntime } from "../../installable-extensions/github/runtime"
import type { ExtensionHostResponse } from "../../src/shared/extension-runtime-protocol"
import {
  getIssueLikeAccessories,
  getRepositoryAccessories,
  getWorkflowRunAccessories
} from "../../installable-extensions/github/src/view-helpers"
import type {
  GitHubIssueLike,
  GitHubRepository,
  GitHubWorkflowRun
} from "../../installable-extensions/github/domain/client-core"

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
    assert.ok(githubRuntime.commands[commandName])
  }
})

test("GitHub runtime accessories serialize as stable text visuals", async () => {
  const issueAccessories = getIssueLikeAccessories(createIssueLike())
  const repositoryAccessories = getRepositoryAccessories(createRepository(), true)
  const workflowAccessories = getWorkflowRunAccessories(createWorkflowRun())

  assert.equal(issueAccessories, "jingle/runtime · 3 comments · Draft")
  assert.equal(repositoryAccessories, "JunJD · TypeScript · 42 stars · 7 forks · Private")
  assert.equal(workflowAccessories, "main · abc1234 · #12")

  const renderer = createExtensionRuntimeRenderer({
    commandName: "my-issues",
    extensionName: "github"
  })
  renderer.render(
    createElement(
      List,
      { navigationTitle: "GitHub Issues" },
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
      text: "jingle/runtime · 3 comments · Draft"
    }
  ])
})

test("GitHub runtime shows connect view when OAuth is not connected", async () => {
  const renderer = createExtensionRuntimeRenderer({
    commandName: "search-repositories",
    extensionName: "github"
  })
  renderer.render(
    createElement(
      ExtensionRuntimeNavigationProvider,
      {
        value: createGitHubRuntimeContext({
          commandName: "search-repositories",
          commandPreferences: {
            displayOwnerName: true,
            includeArchived: false,
            includeForks: false
          },
          extensionPreferences: {}
        })
      },
      createElement(GitHubSearchRepositories)
    )
  )
  await renderer.flushSnapshots()

  const snapshot = renderer.getSnapshot()
  assert.equal(snapshot?.kind, "list")
  if (snapshot?.kind !== "list") {
    return
  }

  assert.equal(snapshot.emptyView?.title, "Connect GitHub")
  assert.equal(
    snapshot.emptyView?.description,
    "GitHub needs to be connected before it can load this command."
  )
  assert.deepEqual(
    snapshot.emptyView?.actions.map((action) => action.title),
    ["Connect GitHub"]
  )
})

function createGitHubRuntimeContext(options: {
  commandName: string
  commandPreferences: Record<string, unknown>
  extensionPreferences: Record<string, unknown>
}): Omit<ExtensionRuntimeHostContextValue, "navigation"> {
  const requestHost = async (): Promise<ExtensionHostResponse> => ({
    id: "github-test-host-response",
    ok: true,
    result: null
  })

  return {
    commandName: options.commandName,
    commandPreferences: options.commandPreferences,
    dataIdentity: { kind: "unavailable" },
    extensionName: "github",
    extensionPreferences: options.extensionPreferences,
    initialAction: "open",
    locale: "zh-CN",
    mode: "view",
    reportFatalError: () => {},
    requestHost,
    seedQuery: ""
  }
}

function createIssueLike(): GitHubIssueLike {
  return {
    comments: 3,
    id: 1,
    isDraft: true,
    kind: "pull_request",
    number: 12,
    repositoryName: "jingle/runtime",
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
