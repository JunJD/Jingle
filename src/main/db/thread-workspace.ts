import { getPrismaClient } from "./client"
import { toNumber } from "./utils"
import type {
  ProjectRecord,
  ThreadWorkspaceBindingRecord,
  ThreadWorkspaceKind
} from "@shared/thread-workspace"
import { ensureDefaultProjectWorkflowTaxonomy } from "./thread-workflow"

export interface ProjectRow {
  archived_at: number | null
  canonical_workspace_path: string
  created_at: number
  display_name: string
  project_id: string
  updated_at: number
  workspace_key: string
}

export interface ThreadWorkspaceBindingRow {
  created_at: number
  project: ProjectRow | null
  project_id: string | null
  thread_id: string
  updated_at: number
  workspace_key: string | null
  workspace_kind: string
  workspace_path: string | null
}

export interface UpsertProjectInput {
  canonicalWorkspacePath: string
  displayName: string
  projectId: string
  workspaceKey: string
}

export interface UpsertThreadWorkspaceBindingInput {
  projectId?: string | null
  threadId: string
  workspaceKey?: string | null
  workspaceKind: ThreadWorkspaceKind
  workspacePath?: string | null
}

function normalizeThreadWorkspaceKind(value: string): ThreadWorkspaceKind {
  if (value === "project" || value === "projectless") {
    return value
  }

  throw new Error(`Unknown thread workspace kind: ${value}`)
}

function mapProjectRow(row: {
  archivedAt: bigint | null
  canonicalWorkspacePath: string
  createdAt: bigint
  displayName: string
  projectId: string
  updatedAt: bigint
  workspaceKey: string
}): ProjectRow {
  return {
    archived_at: row.archivedAt === null ? null : toNumber(row.archivedAt),
    canonical_workspace_path: row.canonicalWorkspacePath,
    created_at: toNumber(row.createdAt),
    display_name: row.displayName,
    project_id: row.projectId,
    updated_at: toNumber(row.updatedAt),
    workspace_key: row.workspaceKey
  }
}

function mapBindingRow(row: {
  createdAt: bigint
  project: {
    archivedAt: bigint | null
    canonicalWorkspacePath: string
    createdAt: bigint
    displayName: string
    projectId: string
    updatedAt: bigint
    workspaceKey: string
  } | null
  projectId: string | null
  threadId: string
  updatedAt: bigint
  workspaceKey: string | null
  workspaceKind: string
  workspacePath: string | null
}): ThreadWorkspaceBindingRow {
  return {
    created_at: toNumber(row.createdAt),
    project: row.project ? mapProjectRow(row.project) : null,
    project_id: row.projectId,
    thread_id: row.threadId,
    updated_at: toNumber(row.updatedAt),
    workspace_key: row.workspaceKey,
    workspace_kind: row.workspaceKind,
    workspace_path: row.workspacePath
  }
}

export function mapProjectRecord(row: ProjectRow): ProjectRecord {
  return {
    archivedAt: row.archived_at === null ? null : new Date(row.archived_at),
    canonicalWorkspacePath: row.canonical_workspace_path,
    createdAt: new Date(row.created_at),
    displayName: row.display_name,
    projectId: row.project_id,
    updatedAt: new Date(row.updated_at),
    workspaceKey: row.workspace_key
  }
}

export function mapThreadWorkspaceBindingRecord(
  row: ThreadWorkspaceBindingRow
): ThreadWorkspaceBindingRecord {
  return {
    createdAt: new Date(row.created_at),
    project: row.project ? mapProjectRecord(row.project) : null,
    projectId: row.project_id,
    threadId: row.thread_id,
    updatedAt: new Date(row.updated_at),
    workspaceKey: row.workspace_key,
    workspaceKind: normalizeThreadWorkspaceKind(row.workspace_kind),
    workspacePath: row.workspace_path
  }
}

export async function upsertProject(input: UpsertProjectInput): Promise<ProjectRow> {
  const prisma = getPrismaClient()
  const now = BigInt(Date.now())
  return prisma.$transaction(async (tx) => {
    const row = await tx.project.upsert({
      create: {
        canonicalWorkspacePath: input.canonicalWorkspacePath,
        createdAt: now,
        displayName: input.displayName,
        projectId: input.projectId,
        updatedAt: now,
        workspaceKey: input.workspaceKey
      },
      update: {
        canonicalWorkspacePath: input.canonicalWorkspacePath,
        displayName: input.displayName,
        updatedAt: now
      },
      where: {
        workspaceKey: input.workspaceKey
      }
    })
    await ensureDefaultProjectWorkflowTaxonomy(tx, row.projectId, now)

    return mapProjectRow(row)
  })
}

export async function getProjects(): Promise<ProjectRow[]> {
  const prisma = getPrismaClient()
  const rows = await prisma.project.findMany({
    where: {
      archivedAt: null
    }
  })

  return rows.map(mapProjectRow)
}

export async function getThreadWorkspaceBinding(
  threadId: string
): Promise<ThreadWorkspaceBindingRow | null> {
  const prisma = getPrismaClient()
  const row = await prisma.threadWorkspaceBinding.findUnique({
    include: {
      project: true
    },
    where: {
      threadId
    }
  })

  return row ? mapBindingRow(row) : null
}

export async function getThreadWorkspaceBindings(
  threadIds: readonly string[]
): Promise<ThreadWorkspaceBindingRow[]> {
  if (threadIds.length === 0) {
    return []
  }

  const prisma = getPrismaClient()
  const rows = await prisma.threadWorkspaceBinding.findMany({
    include: {
      project: true
    },
    where: {
      threadId: {
        in: [...threadIds]
      }
    }
  })

  return rows.map(mapBindingRow)
}

export async function upsertThreadWorkspaceBinding(
  input: UpsertThreadWorkspaceBindingInput
): Promise<ThreadWorkspaceBindingRow> {
  const prisma = getPrismaClient()
  const now = BigInt(Date.now())
  const row = await prisma.threadWorkspaceBinding.upsert({
    create: {
      createdAt: now,
      projectId: input.projectId ?? null,
      threadId: input.threadId,
      updatedAt: now,
      workspaceKey: input.workspaceKey ?? null,
      workspaceKind: input.workspaceKind,
      workspacePath: input.workspacePath ?? null
    },
    include: {
      project: true
    },
    update: {
      projectId: input.projectId ?? null,
      updatedAt: now,
      workspaceKey: input.workspaceKey ?? null,
      workspaceKind: input.workspaceKind,
      workspacePath: input.workspacePath ?? null
    },
    where: {
      threadId: input.threadId
    }
  })

  return mapBindingRow(row)
}
