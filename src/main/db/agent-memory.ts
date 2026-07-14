import type { Prisma } from "@prisma/client"
import { randomUUID } from "crypto"
import { readJingleMemoryEvidenceRefsFromReviewPayload } from "@shared/jingle-memory"
import type {
  AcceptJingleMemorySuggestionInput,
  CreateJingleMemoryInput,
  CreateJingleMemorySuggestionInput,
  ListJingleMemoriesInput,
  ListJingleSuggestionsInput,
  JingleMemoryInclusionRecord,
  JingleMemoryRecord,
  JingleMemorySuggestionRecord,
  UpdateJingleMemoryInput
} from "@shared/jingle-memory"
import { getPrismaClient } from "./client"
import { serializeJsonValue, toNumber } from "./utils"

type AgentMemoryModel = Prisma.AgentMemoryGetPayload<Record<string, never>>
type AgentMemorySuggestionModel = Prisma.AgentMemorySuggestionGetPayload<Record<string, never>>
type AgentMemoryInclusionWithMemoryModel = Prisma.AgentMemoryInclusionGetPayload<{
  include: { memory: true }
}>

type WorkspaceScopedInput = { workspaceKey?: string | null }
type ListAgentMemoriesInput = ListJingleMemoriesInput & WorkspaceScopedInput
type ListAgentMemorySuggestionsInput = ListJingleSuggestionsInput & WorkspaceScopedInput
type CreateAgentMemoryInput = CreateJingleMemoryInput & WorkspaceScopedInput
type CreateAgentMemorySuggestionInput = CreateJingleMemorySuggestionInput & WorkspaceScopedInput
type AcceptAgentMemorySuggestionInput = AcceptJingleMemorySuggestionInput & WorkspaceScopedInput
type UpdateAgentMemoryInput = UpdateJingleMemoryInput & WorkspaceScopedInput

function normalizeScopeWorkspace(input: {
  scope: JingleMemoryRecord["scope"]
  workspaceKey?: string | null
}): { scope: JingleMemoryRecord["scope"]; workspaceKey: string | null } {
  if (input.scope === "global") {
    return { scope: "global", workspaceKey: null }
  }

  if (!input.workspaceKey) {
    throw new Error("Workspace-scoped memory requires workspaceKey.")
  }

  return { scope: "workspace", workspaceKey: input.workspaceKey }
}

function parseJsonRecord(value: string | null): Record<string, unknown> | null {
  if (!value) {
    return null
  }

  const parsed = JSON.parse(value) as unknown
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : null
}

function readSuggestionReviewPayloadEvidenceIds(value: string | null): string[] {
  const reviewPayload = parseJsonRecord(value)
  const evidenceIds = reviewPayload?.evidenceIds
  return Array.isArray(evidenceIds)
    ? evidenceIds.filter((entry): entry is string => typeof entry === "string")
    : []
}

function mapMemory(row: AgentMemoryModel): JingleMemoryRecord {
  return {
    content: row.content,
    createdAt: toNumber(row.createdAt),
    lastIncludedAt: row.lastIncludedAt === null ? null : toNumber(row.lastIncludedAt),
    memoryId: row.memoryId,
    metadata: parseJsonRecord(row.metadata),
    scope: row.scope as JingleMemoryRecord["scope"],
    source: row.source as JingleMemoryRecord["source"],
    status: row.status as JingleMemoryRecord["status"],
    type: row.type as JingleMemoryRecord["type"],
    updatedAt: toNumber(row.updatedAt),
    workspaceKey: row.workspaceKey
  }
}

function mapSuggestion(row: AgentMemorySuggestionModel): JingleMemorySuggestionRecord {
  return {
    content: row.content,
    createdAt: toNumber(row.createdAt),
    decision: parseJsonRecord(row.decision),
    reason: row.reason,
    resolvedAt: row.resolvedAt === null ? null : toNumber(row.resolvedAt),
    reviewPayload: parseJsonRecord(row.reviewPayload),
    scope: row.scope as JingleMemorySuggestionRecord["scope"],
    sourceRunId: row.sourceRunId,
    status: row.status as JingleMemorySuggestionRecord["status"],
    suggestionId: row.suggestionId,
    threadId: row.threadId,
    type: row.type as JingleMemorySuggestionRecord["type"],
    updatedAt: toNumber(row.updatedAt),
    workspaceKey: row.workspaceKey
  }
}

function mapInclusion(row: AgentMemoryInclusionWithMemoryModel): JingleMemoryInclusionRecord {
  return {
    content: row.memory.content,
    createdAt: toNumber(row.createdAt),
    inclusionId: row.inclusionId,
    memoryId: row.memoryId,
    runId: row.runId,
    scope: row.memory.scope as JingleMemoryInclusionRecord["scope"],
    threadId: row.threadId,
    type: row.memory.type as JingleMemoryInclusionRecord["type"],
    workspaceKey: row.memory.workspaceKey
  }
}

function buildWorkspaceWhere(input: {
  scope?: string
  workspaceKey?: string | null
}): Prisma.AgentMemoryWhereInput {
  if (input.scope === "global") {
    return { scope: "global" }
  }

  if (input.scope === "workspace") {
    return input.workspaceKey
      ? { scope: "workspace", workspaceKey: input.workspaceKey }
      : { AND: [{ scope: "workspace" }, { workspaceKey: "__missing_workspace_key__" }] }
  }

  return input.workspaceKey
    ? {
        OR: [{ scope: "global" }, { scope: "workspace", workspaceKey: input.workspaceKey }]
      }
    : { scope: "global" }
}

function buildSuggestionWorkspaceWhere(input: {
  scope?: string
  workspaceKey?: string | null
}): Prisma.AgentMemorySuggestionWhereInput {
  if (input.scope === "global") {
    return { scope: "global" }
  }

  if (input.scope === "workspace") {
    return input.workspaceKey
      ? { scope: "workspace", workspaceKey: input.workspaceKey }
      : { AND: [{ scope: "workspace" }, { workspaceKey: "__missing_workspace_key__" }] }
  }

  return input.workspaceKey
    ? {
        OR: [{ scope: "global" }, { scope: "workspace", workspaceKey: input.workspaceKey }]
      }
    : { scope: "global" }
}

export async function listAgentMemories(
  input: ListAgentMemoriesInput = {}
): Promise<JingleMemoryRecord[]> {
  const prisma = getPrismaClient()
  const rows = await prisma.agentMemory.findMany({
    where: {
      ...buildWorkspaceWhere(input),
      ...(input.status ? { status: input.status } : {}),
      ...(input.type ? { type: input.type } : {}),
      ...(input.query ? { content: { contains: input.query } } : {})
    },
    orderBy: [{ updatedAt: "desc" }]
  })

  return rows.map(mapMemory)
}

export async function createAgentMemorySuggestion(
  input: CreateAgentMemorySuggestionInput
): Promise<JingleMemorySuggestionRecord> {
  const prisma = getPrismaClient()
  const now = BigInt(Date.now())
  const content = input.content.trim()
  const scopeWorkspace = normalizeScopeWorkspace(input)
  const existing = await prisma.agentMemorySuggestion.findFirst({
    where: {
      content,
      scope: scopeWorkspace.scope,
      status: "pending",
      type: input.type,
      workspaceKey: scopeWorkspace.workspaceKey
    }
  })

  if (existing) {
    return mapSuggestion(existing)
  }

  const row = await prisma.agentMemorySuggestion.create({
    data: {
      suggestionId: randomUUID(),
      type: input.type,
      scope: scopeWorkspace.scope,
      workspaceKey: scopeWorkspace.workspaceKey,
      content,
      reason: input.reason?.trim() || null,
      reviewPayload: serializeJsonValue(input.reviewPayload) ?? null,
      status: "pending",
      threadId: input.threadId ?? null,
      sourceRunId: input.sourceRunId ?? null,
      createdAt: now,
      updatedAt: now
    }
  })

  return mapSuggestion(row)
}

export async function createAgentMemory(
  input: CreateAgentMemoryInput
): Promise<JingleMemoryRecord> {
  const prisma = getPrismaClient()
  const now = BigInt(Date.now())
  const scopeWorkspace = normalizeScopeWorkspace(input)
  const row = await prisma.agentMemory.create({
    data: {
      memoryId: randomUUID(),
      type: input.type,
      scope: scopeWorkspace.scope,
      workspaceKey: scopeWorkspace.workspaceKey,
      content: input.content.trim(),
      status: "active",
      source: "user",
      metadata: serializeJsonValue(input.metadata) ?? null,
      createdAt: now,
      updatedAt: now
    }
  })

  return mapMemory(row)
}

export async function listAgentMemorySuggestions(
  input: ListAgentMemorySuggestionsInput = {}
): Promise<JingleMemorySuggestionRecord[]> {
  const prisma = getPrismaClient()
  const rows = await prisma.agentMemorySuggestion.findMany({
    where: {
      ...buildSuggestionWorkspaceWhere(input),
      ...(input.status ? { status: input.status } : {}),
      ...(input.threadId ? { threadId: input.threadId } : {})
    },
    orderBy: [{ updatedAt: "desc" }]
  })

  return rows.map(mapSuggestion)
}

export async function hasPendingWorkspaceMemorySuggestions(threadId: string): Promise<boolean> {
  const prisma = getPrismaClient()
  const count = await prisma.agentMemorySuggestion.count({
    where: {
      scope: "workspace",
      status: "pending",
      threadId
    }
  })

  return count > 0
}

export async function acceptAgentMemorySuggestion(
  suggestionId: string,
  input: AcceptAgentMemorySuggestionInput = {}
): Promise<JingleMemoryRecord> {
  const prisma = getPrismaClient()
  const now = BigInt(Date.now())

  const result = await prisma.$transaction(async (tx) => {
    const suggestion = await tx.agentMemorySuggestion.findUnique({
      where: { suggestionId }
    })

    if (!suggestion) {
      throw new Error(`Unknown memory suggestion "${suggestionId}"`)
    }

    if (suggestion.status !== "pending") {
      throw new Error(`Memory suggestion "${suggestionId}" is already ${suggestion.status}.`)
    }

    const scopeWorkspace = normalizeScopeWorkspace({
      scope: (input.scope ?? suggestion.scope) as JingleMemoryRecord["scope"],
      workspaceKey: input.workspaceKey !== undefined ? input.workspaceKey : suggestion.workspaceKey
    })
    const evidenceIds = readSuggestionReviewPayloadEvidenceIds(suggestion.reviewPayload)
    const evidenceRefs = readJingleMemoryEvidenceRefsFromReviewPayload(
      parseJsonRecord(suggestion.reviewPayload)
    )
    const memory = await tx.agentMemory.create({
      data: {
        memoryId: randomUUID(),
        type: input.type ?? suggestion.type,
        scope: scopeWorkspace.scope,
        workspaceKey: scopeWorkspace.workspaceKey,
        content: input.content?.trim() || suggestion.content,
        status: "active",
        source: "agent_suggestion",
        createdAt: now,
        updatedAt: now,
        metadata: serializeJsonValue({
          acceptedSuggestionId: suggestion.suggestionId,
          ...(evidenceIds.length > 0 ? { evidenceIds } : {}),
          ...(evidenceRefs.length > 0 ? { evidenceRefs } : {}),
          sourceRunId: suggestion.sourceRunId,
          threadId: suggestion.threadId
        })
      }
    })

    await tx.agentMemorySuggestion.update({
      where: { suggestionId },
      data: {
        status: "accepted",
        updatedAt: now,
        resolvedAt: now,
        decision: serializeJsonValue({
          memoryId: memory.memoryId,
          content: memory.content,
          scope: memory.scope,
          type: memory.type,
          workspaceKey: memory.workspaceKey
        })
      }
    })

    return memory
  })

  return mapMemory(result)
}

export async function rejectAgentMemorySuggestion(
  suggestionId: string
): Promise<JingleMemorySuggestionRecord> {
  const prisma = getPrismaClient()
  const now = BigInt(Date.now())
  const row = await prisma.agentMemorySuggestion.update({
    where: { suggestionId },
    data: {
      status: "rejected",
      updatedAt: now,
      resolvedAt: now
    }
  })

  return mapSuggestion(row)
}

export async function updateAgentMemory(
  memoryId: string,
  input: UpdateAgentMemoryInput
): Promise<JingleMemoryRecord> {
  const prisma = getPrismaClient()
  const existing = await prisma.agentMemory.findUnique({ where: { memoryId } })

  if (!existing) {
    throw new Error(`Unknown memory "${memoryId}"`)
  }

  const scopeWorkspace =
    input.scope !== undefined || input.workspaceKey !== undefined
      ? normalizeScopeWorkspace({
          scope: (input.scope ?? existing.scope) as JingleMemoryRecord["scope"],
          workspaceKey: input.workspaceKey !== undefined ? input.workspaceKey : existing.workspaceKey
        })
      : null
  const row = await prisma.agentMemory.update({
    where: { memoryId },
    data: {
      ...(input.content !== undefined ? { content: input.content.trim() } : {}),
      ...(scopeWorkspace
        ? { scope: scopeWorkspace.scope, workspaceKey: scopeWorkspace.workspaceKey }
        : {}),
      ...(input.type !== undefined ? { type: input.type } : {}),
      updatedAt: BigInt(Date.now())
    }
  })

  return mapMemory(row)
}

export async function archiveAgentMemory(memoryId: string): Promise<JingleMemoryRecord> {
  const prisma = getPrismaClient()
  const row = await prisma.agentMemory.update({
    where: { memoryId },
    data: {
      status: "archived",
      updatedAt: BigInt(Date.now())
    }
  })

  return mapMemory(row)
}

export async function restoreAgentMemory(memoryId: string): Promise<JingleMemoryRecord> {
  const prisma = getPrismaClient()
  const row = await prisma.agentMemory.update({
    where: { memoryId },
    data: {
      status: "active",
      updatedAt: BigInt(Date.now())
    }
  })

  return mapMemory(row)
}

export async function deleteAgentMemory(memoryId: string): Promise<void> {
  const prisma = getPrismaClient()
  await prisma.agentMemory.delete({
    where: { memoryId }
  })
}

export async function recordAgentMemoryInclusions(input: {
  memoryIds: string[]
  runId: string
  threadId: string
}): Promise<void> {
  const prisma = getPrismaClient()
  const uniqueMemoryIds = Array.from(new Set(input.memoryIds))
  if (uniqueMemoryIds.length === 0) {
    return
  }

  const now = BigInt(Date.now())
  await prisma.$transaction([
    ...uniqueMemoryIds.map((memoryId) =>
      prisma.agentMemoryInclusion.upsert({
        where: {
          memoryId_runId: {
            memoryId,
            runId: input.runId
          }
        },
        create: {
          inclusionId: randomUUID(),
          memoryId,
          threadId: input.threadId,
          runId: input.runId,
          createdAt: now
        },
        update: {}
      })
    ),
    prisma.agentMemory.updateMany({
      where: { memoryId: { in: uniqueMemoryIds } },
      data: {
        lastIncludedAt: now
      }
    })
  ])
}

export async function listAgentMemoryInclusionsForRun(
  runId: string
): Promise<JingleMemoryInclusionRecord[]> {
  const prisma = getPrismaClient()
  const rows = await prisma.agentMemoryInclusion.findMany({
    where: { runId },
    include: { memory: true },
    orderBy: { createdAt: "asc" }
  })

  return rows.map(mapInclusion)
}

export async function getAgentMemory(memoryId: string): Promise<JingleMemoryRecord | null> {
  const prisma = getPrismaClient()
  const row = await prisma.agentMemory.findUnique({
    where: { memoryId }
  })

  return row ? mapMemory(row) : null
}

export async function getAgentMemorySuggestion(
  suggestionId: string
): Promise<JingleMemorySuggestionRecord | null> {
  const prisma = getPrismaClient()
  const row = await prisma.agentMemorySuggestion.findUnique({
    where: { suggestionId }
  })

  return row ? mapSuggestion(row) : null
}
