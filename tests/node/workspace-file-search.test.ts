import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test, { after, before } from "node:test"
import { createThread, initializeDatabase, closeDatabase } from "../../src/main/db"
import { WorkspaceRepository } from "../../src/main/workspace/repository"
import { WorkspaceService } from "../../src/main/workspace/service"

class MemorySafeOpenworkMemoryService {
  hasPendingWorkspaceSuggestions(): Promise<boolean> {
    return Promise.resolve(false)
  }
}

async function createWorkspaceService(
  threadId: string,
  workspacePath: string
): Promise<WorkspaceService> {
  const repository = new WorkspaceRepository()
  await createThread(threadId, {
    metadata: {
      workspacePath
    }
  })
  return new WorkspaceService(
    repository,
    new MemorySafeOpenworkMemoryService() as unknown as ConstructorParameters<
      typeof WorkspaceService
    >[1]
  )
}

before(async () => {
  await initializeDatabase()
})

after(async () => {
  await closeDatabase()
})

test("workspace file search returns workspace-relative file refs", async () => {
  const root = await mkdtemp(join(tmpdir(), "openwork-workspace-search-"))
  try {
    await mkdir(join(root, "src", "main"), { recursive: true })
    await writeFile(join(root, "src", "main", "service.ts"), "export const service = true\n")
    await writeFile(join(root, "README.md"), "# Workspace\n")

    const threadId = `thread-search-${randomUUID()}`
    const service = await createWorkspaceService(threadId, root)
    const result = await service.searchFiles({
      query: "service",
      threadId
    })

    assert.deepEqual(result, {
      success: true,
      files: [
        {
          name: "service.ts",
          path: "src/main/service.ts"
        }
      ]
    })
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})

test("workspace file search includes hidden workspace files like opencode", async () => {
  const root = await mkdtemp(join(tmpdir(), "openwork-workspace-hidden-"))
  try {
    await mkdir(join(root, ".github", "workflows"), { recursive: true })
    await writeFile(join(root, ".github", "workflows", "ci.yml"), "name: ci\n")

    const threadId = `thread-hidden-search-${randomUUID()}`
    const service = await createWorkspaceService(threadId, root)
    const result = await service.searchFiles({
      query: "ci",
      threadId
    })

    assert.deepEqual(result, {
      success: true,
      files: [
        {
          name: "ci.yml",
          path: ".github/workflows/ci.yml"
        }
      ]
    })
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})

test("workspace file search ranks across the full ripgrep file list", async () => {
  const root = await mkdtemp(join(tmpdir(), "openwork-workspace-large-search-"))
  try {
    await mkdir(join(root, "bulk"), { recursive: true })
    await mkdir(join(root, "deep"), { recursive: true })
    await Promise.all(
      Array.from({ length: 5050 }, (_, index) =>
        writeFile(join(root, "bulk", `file-${index.toString().padStart(4, "0")}.txt`), "\n")
      )
    )
    await writeFile(join(root, "deep", "needle-workspace-file.ts"), "export const found = true\n")

    const threadId = `thread-large-search-${randomUUID()}`
    const service = await createWorkspaceService(threadId, root)
    const result = await service.searchFiles({
      query: "needleworkspacefile",
      threadId
    })

    assert.deepEqual(result, {
      success: true,
      files: [
        {
          name: "needle-workspace-file.ts",
          path: "deep/needle-workspace-file.ts"
        }
      ]
    })
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})

test("workspace read file rejects sibling prefix path escapes", async () => {
  const parent = await mkdtemp(join(tmpdir(), "openwork-workspace-parent-"))
  const workspacePath = join(parent, "workspace")
  const siblingPath = join(parent, "workspace-neighbor")
  try {
    await mkdir(workspacePath, { recursive: true })
    await mkdir(siblingPath, { recursive: true })
    await writeFile(join(siblingPath, "secret.txt"), "nope\n")

    const threadId = `thread-path-escape-${randomUUID()}`
    const service = await createWorkspaceService(threadId, workspacePath)
    const result = await service.readFile({
      filePath: "../workspace-neighbor/secret.txt",
      threadId
    })

    assert.deepEqual(result, {
      success: false,
      error: "Access denied: path outside workspace"
    })
  } finally {
    await rm(parent, { force: true, recursive: true })
  }
})
