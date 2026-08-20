import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import type { JingleWorkspaceIdentity } from "../../src/shared/jingle-memory"

const repoRoot = process.cwd()
const originalJingleHome = process.env.JINGLE_HOME
let jingleHome = ""

test.before(async () => {
  jingleHome = await mkdtemp(join(tmpdir(), "jingle-memory-workspace-mutation-"))
  process.env.JINGLE_HOME = jingleHome
  execFileSync("node", ["scripts/run-prisma-jingle-db.mjs", "migrate", "deploy"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      JINGLE_HOME: jingleHome
    }
  })
})

test.beforeEach(async () => {
  const { closeDatabase, initializeDatabase } = await import("../../src/main/db")
  const { getPrismaClient } = await import("../../src/main/db/client")
  await closeDatabase()
  await initializeDatabase()
  await getPrismaClient().agentMemory.deleteMany()
})

test.after(async () => {
  const { closeDatabase } = await import("../../src/main/db")
  await closeDatabase()
  if (originalJingleHome === undefined) {
    delete process.env.JINGLE_HOME
  } else {
    process.env.JINGLE_HOME = originalJingleHome
  }
  await rm(jingleHome, { force: true, recursive: true })
})

test("memory status mutation atomically rejects stale and malformed workspace owners", async () => {
  const { archiveAgentMemory, createAgentMemory, getAgentMemory, restoreAgentMemory } =
    await import("../../src/main/db/agent-memory")
  const { getPrismaClient } = await import("../../src/main/db/client")

  const memory = await createAgentMemory({
    content: "Workspace A owns this memory.",
    scope: "workspace",
    type: "workspace_context",
    workspaceKey: "workspace-a"
  })

  await getPrismaClient().agentMemory.update({
    where: { memoryId: memory.memoryId },
    data: { workspaceKey: "workspace-b" }
  })

  await assert.rejects(
    archiveAgentMemory(memory.memoryId, "workspace-a"),
    /Unknown or inaccessible memory/
  )
  assert.equal((await getAgentMemory(memory.memoryId))?.status, "active")

  const archived = await archiveAgentMemory(memory.memoryId, "workspace-b")
  assert.equal(archived.status, "archived")

  await assert.rejects(
    restoreAgentMemory(memory.memoryId, "workspace-a"),
    /Unknown or inaccessible memory/
  )
  assert.equal((await getAgentMemory(memory.memoryId))?.status, "archived")

  await getPrismaClient().agentMemory.update({
    where: { memoryId: memory.memoryId },
    data: { scope: "global", workspaceKey: "malformed-workspace-key" }
  })

  await assert.rejects(restoreAgentMemory(memory.memoryId, null), /Unknown or inaccessible memory/)
  assert.equal((await getAgentMemory(memory.memoryId))?.status, "archived")
})

test("memory service mutates global or current-workspace records through the repository predicate", async () => {
  const { createAgentMemory, getAgentMemory } = await import("../../src/main/db/agent-memory")
  const { JingleMemoryService } = await import("../../src/main/jingle-memory/service")

  class WorkspaceMemoryService extends JingleMemoryService {
    constructor(private readonly workspaceIdentity: JingleWorkspaceIdentity | null) {
      super()
    }

    override async getCurrentWorkspaceIdentity(): Promise<JingleWorkspaceIdentity | null> {
      return this.workspaceIdentity
    }
  }

  const workspaceMemory = await createAgentMemory({
    content: "Workspace A memory.",
    scope: "workspace",
    type: "workspace_context",
    workspaceKey: "workspace-a"
  })
  const globalMemory = await createAgentMemory({
    content: "Global memory.",
    scope: "global",
    type: "about_me"
  })
  const workspaceA: JingleWorkspaceIdentity = {
    canonicalWorkspacePath: "/workspace-a",
    displayName: "workspace-a",
    workspaceKey: "workspace-a"
  }
  const workspaceB: JingleWorkspaceIdentity = {
    canonicalWorkspacePath: "/workspace-b",
    displayName: "workspace-b",
    workspaceKey: "workspace-b"
  }

  await assert.rejects(
    new WorkspaceMemoryService(workspaceB).archiveMemory(workspaceMemory.memoryId),
    /Unknown or inaccessible memory/
  )
  assert.equal((await getAgentMemory(workspaceMemory.memoryId))?.status, "active")

  assert.equal(
    (await new WorkspaceMemoryService(workspaceA).archiveMemory(workspaceMemory.memoryId)).status,
    "archived"
  )
  assert.equal(
    (await new WorkspaceMemoryService(null).archiveMemory(globalMemory.memoryId)).status,
    "archived"
  )
  assert.equal(
    (await new WorkspaceMemoryService(null).restoreMemory(globalMemory.memoryId)).status,
    "active"
  )

  await assert.rejects(
    new WorkspaceMemoryService(workspaceA).restoreMemory("unknown-memory"),
    /Unknown or inaccessible memory/
  )
})
