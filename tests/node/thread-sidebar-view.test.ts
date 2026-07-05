import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test, { after, before } from "node:test"
import {
  closeDatabase,
  createThread,
  initializeDatabase,
  setThreadArchived
} from "../../src/main/db"
import { ThreadSidebarRepository } from "../../src/main/thread-sidebar/repository"
import { ThreadSidebarService } from "../../src/main/thread-sidebar/service"
import { ThreadWorkspaceRepository } from "../../src/main/thread-workspace/repository"
import { ThreadWorkspaceService } from "../../src/main/thread-workspace/service"

const repoRoot = process.cwd()
const originalJingleHome = process.env.JINGLE_HOME
let jingleHome = ""

before(async () => {
  jingleHome = await mkdtemp(join(tmpdir(), "jingle-sidebar-view-home-"))
  process.env.JINGLE_HOME = jingleHome
  execFileSync("node", ["scripts/run-prisma-jingle-db.mjs", "migrate", "deploy"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      JINGLE_HOME: jingleHome,
    }
  })
  await initializeDatabase()
})

after(async () => {
  await closeDatabase()
  if (originalJingleHome === undefined) {
    delete process.env.JINGLE_HOME
  } else {
    process.env.JINGLE_HOME = originalJingleHome
  }
  await rm(jingleHome, { force: true, recursive: true })
})

function createThreadMetadata(input: { pinned?: boolean }): Record<string, unknown> {
  if (!input.pinned) {
    return {}
  }

  return { pinned: true }
}

async function createProjectThread(input: {
  id: string
  pinned?: boolean
  title: string
  workspacePath: string
}): Promise<void> {
  await createThread(input.id, {
    metadata: createThreadMetadata(input),
    title: input.title
  })
  await new ThreadWorkspaceService(new ThreadWorkspaceRepository()).bindProject(
    input.id,
    input.workspacePath
  )
}

async function createProjectlessThread(input: {
  id: string
  pinned?: boolean
  title: string
  workspacePath?: string
}): Promise<void> {
  await createThread(input.id, {
    metadata: createThreadMetadata(input),
    title: input.title
  })
  await new ThreadWorkspaceService(new ThreadWorkspaceRepository()).markProjectless(
    input.id,
    input.workspacePath
  )
}

test("thread sidebar view groups project, projectless, and pinned facts", async () => {
  new ThreadSidebarService(new ThreadSidebarRepository()).resetPreferences()
  const workspaceRoot = await mkdtemp(join(tmpdir(), "jingle-sidebar-project-"))
  try {
    const projectPath = join(workspaceRoot, "jingle")
    const defaultWorkspacePath = join(workspaceRoot, "AI Space", "default-thread")
    const emptyProjectPath = join(workspaceRoot, "jingle-web")
    await new ThreadWorkspaceService(new ThreadWorkspaceRepository()).addProject(emptyProjectPath)
    await createProjectThread({
      id: `sidebar-project-${randomUUID()}`,
      title: "Project Chat",
      workspacePath: projectPath
    })
    await createProjectlessThread({
      id: `sidebar-loose-${randomUUID()}`,
      title: "Loose Chat"
    })
    await createProjectlessThread({
      id: `sidebar-default-workspace-${randomUUID()}`,
      title: "Default Workspace Chat",
      workspacePath: defaultWorkspacePath
    })
    await createProjectThread({
      id: `sidebar-pinned-${randomUUID()}`,
      pinned: true,
      title: "Pinned Chat",
      workspacePath: projectPath
    })

    const view = await new ThreadSidebarService(new ThreadSidebarRepository()).getView()

    assert.ok(view.pinnedThreads.some((thread) => thread.title === "Pinned Chat"))
    assert.ok(view.chatThreads.some((thread) => thread.title === "Loose Chat"))
    assert.ok(
      view.chatThreads.some(
        (thread) =>
          thread.title === "Default Workspace Chat" &&
          thread.workspaceKind === "projectless" &&
          thread.workspacePath === defaultWorkspacePath
      )
    )
    assert.ok(!view.projectGroups.some((group) => group.workspacePath === defaultWorkspacePath))
    assert.ok(
      view.projectGroups.some(
        (group) =>
          group.workspacePath === projectPath &&
          group.threads.some((thread) => thread.title === "Project Chat") &&
          !group.threads.some((thread) => thread.title === "Pinned Chat")
      )
    )
    assert.ok(
      view.projectGroups.some(
        (group) => group.workspacePath === emptyProjectPath && group.threads.length === 0
      )
    )
  } finally {
    await rm(workspaceRoot, { force: true, recursive: true })
  }
})

test("thread sidebar view applies created and manual sort preferences", async () => {
  const service = new ThreadSidebarService(new ThreadSidebarRepository())
  service.resetPreferences()
  const olderId = `sidebar-order-older-${randomUUID()}`
  const newerId = `sidebar-order-newer-${randomUUID()}`
  await createProjectlessThread({ id: olderId, title: "Older Manual" })
  await createProjectlessThread({ id: newerId, title: "Newer Manual" })

  await service.setSortBy("created")
  const createdView = await service.getView()
  const createdTitles = createdView.chatThreads.map((thread) => thread.title)
  assert.ok(createdTitles.indexOf("Newer Manual") < createdTitles.indexOf("Older Manual"))

  service.resetPreferences()
  const repository = new ThreadSidebarRepository()
  repository.setPreferences({
    manualThreadOrder: [olderId, newerId],
    organizeMode: "project",
    projectOrder: [],
    sortBy: "manual"
  })
  const manualView = await new ThreadSidebarService(repository).getView()
  const manualThreadIds = manualView.chatThreads.map((thread) => thread.threadId)
  assert.ok(manualThreadIds.indexOf(olderId) < manualThreadIds.indexOf(newerId))
})

test("thread sidebar view excludes archived threads while preserving active project groups", async () => {
  new ThreadSidebarService(new ThreadSidebarRepository()).resetPreferences()
  const workspaceRoot = await mkdtemp(join(tmpdir(), "jingle-sidebar-archive-"))
  try {
    const projectPath = join(workspaceRoot, "jingle")
    const archivedId = `sidebar-archived-${randomUUID()}`
    await createProjectThread({
      id: archivedId,
      title: "Archived Project Chat",
      workspacePath: projectPath
    })
    await createProjectThread({
      id: `sidebar-active-${randomUUID()}`,
      title: "Active Project Chat",
      workspacePath: projectPath
    })
    await setThreadArchived(archivedId, true)

    const view = await new ThreadSidebarService(new ThreadSidebarRepository()).getView()
    const projectGroup = view.projectGroups.find((group) => group.workspacePath === projectPath)

    assert.ok(projectGroup)
    assert.ok(projectGroup.threads.some((thread) => thread.title === "Active Project Chat"))
    assert.ok(!projectGroup.threads.some((thread) => thread.title === "Archived Project Chat"))
    assert.ok(!view.chatThreads.some((thread) => thread.title === "Archived Project Chat"))
    assert.ok(!view.pinnedThreads.some((thread) => thread.title === "Archived Project Chat"))
  } finally {
    await rm(workspaceRoot, { force: true, recursive: true })
  }
})
