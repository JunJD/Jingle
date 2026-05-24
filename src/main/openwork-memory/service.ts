import type {
  AcceptOpenworkMemorySuggestionInput,
  CreateOpenworkMemoryInput,
  CreateOpenworkMemorySuggestionInput,
  ListOpenworkMemoriesInput,
  ListOpenworkSuggestionsInput,
  OpenworkContextSourceRecord,
  OpenworkMemoryContextItem,
  OpenworkMemoryContextPack,
  OpenworkMemoryContextSnapshot,
  OpenworkMemoryInclusionRecord,
  OpenworkMemoryRecord,
  OpenworkMemorySettings,
  OpenworkMemorySuggestionRecord,
  OpenworkWorkspaceIdentity,
  UpdateOpenworkMemoryInput
} from "@shared/openwork-memory"
import {
  acceptAgentMemorySuggestion,
  archiveAgentMemory,
  createAgentMemory,
  createAgentMemorySuggestion,
  deleteAgentMemory,
  getAgentMemory,
  getAgentMemorySuggestion,
  hasPendingWorkspaceMemorySuggestions,
  listAgentMemories,
  listAgentMemoryInclusionsForRun,
  listAgentMemorySuggestions,
  recordAgentMemoryInclusions,
  rejectAgentMemorySuggestion,
  updateAgentMemory
} from "../db/agent-memory"
import { getThread } from "../db"
import {
  getGlobalWorkspacePath,
  getOpenworkMemorySettings,
  setOpenworkMemorySettings
} from "../preferences"
import { resolveOpenworkWorkspaceIdentity } from "../workspace/identity"
import { OpenworkMemorySourceProvider } from "./source-provider"

const CONTEXT_SNAPSHOT_ITEM_CONTENT_LIMIT = 8_000
const CONTEXT_SNAPSHOT_TOTAL_CONTENT_LIMIT = 48_000

const MEMORY_LIMITS = {
  about_me: 12,
  correction: 12,
  workspace_context: 16
} as const

interface BuildContextPackInput {
  temporaryMode?: boolean
  workspaceIdentity: OpenworkWorkspaceIdentity
}

function truncateSnapshotItems(items: OpenworkMemoryContextItem[]): {
  items: OpenworkMemoryContextItem[]
  snapshotTruncated: boolean
} {
  let remainingTotal = CONTEXT_SNAPSHOT_TOTAL_CONTENT_LIMIT
  let snapshotTruncated = false
  const nextItems = items.flatMap((item) => {
    if (remainingTotal <= 0) {
      snapshotTruncated = true
      return []
    }

    const itemLimit = Math.min(CONTEXT_SNAPSHOT_ITEM_CONTENT_LIMIT, remainingTotal)
    if (item.content.length <= itemLimit) {
      remainingTotal -= item.content.length
      return [item]
    }

    snapshotTruncated = true
    remainingTotal = 0
    return [
      {
        ...item,
        content: item.content.slice(0, itemLimit),
        truncated: true
      }
    ]
  })

  return { items: nextItems, snapshotTruncated }
}

function toStructuredContextItem(memory: OpenworkMemoryRecord): OpenworkMemoryContextItem {
  return {
    content: memory.content,
    id: `memory:${memory.memoryId}`,
    kind: memory.type,
    scope: memory.scope,
    sourceLabel:
      memory.scope === "workspace" ? "Current workspace memory" : "Global personal memory",
    sourceType: "structured",
    structuredMemoryId: memory.memoryId
  }
}

function filterMemoryType(
  memories: OpenworkMemoryRecord[],
  type: OpenworkMemoryRecord["type"]
): OpenworkMemoryRecord[] {
  return memories
    .filter((memory) => memory.type === type)
    .slice(0, MEMORY_LIMITS[type])
}

export class OpenworkMemoryService {
  constructor(private readonly sourceProvider = new OpenworkMemorySourceProvider()) {}

  getSettings(): OpenworkMemorySettings {
    return getOpenworkMemorySettings()
  }

  setSettings(updates: Partial<OpenworkMemorySettings>): OpenworkMemorySettings {
    return setOpenworkMemorySettings(updates)
  }

  async getCurrentWorkspaceIdentity(): Promise<OpenworkWorkspaceIdentity | null> {
    const workspacePath = getGlobalWorkspacePath()
    return workspacePath ? resolveOpenworkWorkspaceIdentity(workspacePath) : null
  }

  async getThreadWorkspaceIdentity(threadId: string): Promise<OpenworkWorkspaceIdentity | null> {
    const thread = await getThread(threadId)
    const metadata = thread?.metadata ? JSON.parse(thread.metadata) : {}
    const workspacePath = metadata.workspacePath

    return typeof workspacePath === "string" && workspacePath.trim().length > 0
      ? resolveOpenworkWorkspaceIdentity(workspacePath)
      : null
  }

  async listContextSources(): Promise<OpenworkContextSourceRecord[]> {
    const workspaceIdentity = await this.getCurrentWorkspaceIdentity()
    return workspaceIdentity
      ? this.sourceProvider.listContextSources(workspaceIdentity.canonicalWorkspacePath)
      : []
  }

  async buildContextPack(input: BuildContextPackInput): Promise<OpenworkMemoryContextPack | null> {
    const { workspaceIdentity } = input
    const fileContext = await this.sourceProvider.listContextItems(
      workspaceIdentity.canonicalWorkspacePath
    )

    if (fileContext.diagnostics.length > 0) {
      console.warn("[OpenworkMemory] Failed to read context sources:", fileContext.diagnostics)
    }

    if (input.temporaryMode || !this.getSettings().useMemory) {
      return {
        canonicalWorkspacePath: workspaceIdentity.canonicalWorkspacePath,
        ...(fileContext.diagnostics.length > 0 ? { diagnostics: fileContext.diagnostics } : {}),
        generatedAt: Date.now(),
        items: fileContext.items,
        ...(input.temporaryMode ? { temporaryMode: true } : {}),
        workspaceIdentity,
        workspaceKey: workspaceIdentity.workspaceKey
      }
    }

    const memories = await listAgentMemories({
      status: "active",
      workspaceKey: workspaceIdentity.workspaceKey
    })
    const structuredItems = [
      ...filterMemoryType(memories, "about_me"),
      ...filterMemoryType(memories, "workspace_context"),
      ...filterMemoryType(memories, "correction")
    ].map(toStructuredContextItem)

    const items = [...fileContext.items, ...structuredItems]
    return {
      canonicalWorkspacePath: workspaceIdentity.canonicalWorkspacePath,
      ...(fileContext.diagnostics.length > 0 ? { diagnostics: fileContext.diagnostics } : {}),
      generatedAt: Date.now(),
      items,
      workspaceIdentity,
      workspaceKey: workspaceIdentity.workspaceKey
    }
  }

  createContextSnapshot(
    contextPack: OpenworkMemoryContextPack | null
  ): OpenworkMemoryContextSnapshot | null {
    if (!contextPack) {
      return null
    }
    const snapshotItems = truncateSnapshotItems(contextPack.items)

    return {
      canonicalWorkspacePath: contextPack.canonicalWorkspacePath,
      ...(contextPack.diagnostics ? { diagnostics: contextPack.diagnostics } : {}),
      generatedAt: contextPack.generatedAt,
      items: snapshotItems.items,
      ...(contextPack.snapshotTruncated || snapshotItems.snapshotTruncated
        ? { snapshotTruncated: true }
        : {}),
      ...(contextPack.temporaryMode ? { temporaryMode: true } : {}),
      workspaceIdentity: contextPack.workspaceIdentity,
      workspaceKey: contextPack.workspaceKey
    }
  }

  rebuildContextPackFromSnapshot(
    snapshot: OpenworkMemoryContextSnapshot | null
  ): OpenworkMemoryContextPack | null {
    if (!snapshot) {
      return null
    }

    return {
      canonicalWorkspacePath: snapshot.canonicalWorkspacePath,
      ...(snapshot.diagnostics ? { diagnostics: snapshot.diagnostics } : {}),
      generatedAt: snapshot.generatedAt,
      items: snapshot.items,
      ...(snapshot.snapshotTruncated ? { snapshotTruncated: true } : {}),
      ...(snapshot.temporaryMode ? { temporaryMode: true } : {}),
      workspaceIdentity: snapshot.workspaceIdentity,
      workspaceKey: snapshot.workspaceKey
    }
  }

  async listMemories(input: ListOpenworkMemoriesInput): Promise<OpenworkMemoryRecord[]> {
    const workspaceIdentity = await this.getCurrentWorkspaceIdentity()
    return listAgentMemories({
      ...input,
      workspaceKey: workspaceIdentity?.workspaceKey ?? null
    })
  }

  async createMemory(input: CreateOpenworkMemoryInput): Promise<OpenworkMemoryRecord> {
    const workspaceIdentity =
      input.scope === "workspace" ? await this.requireCurrentWorkspaceIdentity() : null

    return createAgentMemory({
      ...input,
      workspaceKey: workspaceIdentity?.workspaceKey ?? null
    })
  }

  listSuggestions(
    input: ListOpenworkSuggestionsInput
  ): Promise<OpenworkMemorySuggestionRecord[]> {
    return this.listSuggestionsForCurrentWorkspace(input)
  }

  createSuggestion(
    input: CreateOpenworkMemorySuggestionInput,
    workspaceIdentity?: OpenworkWorkspaceIdentity
  ): Promise<OpenworkMemorySuggestionRecord> {
    return this.createSuggestionForWorkspace(input, workspaceIdentity)
  }

  acceptSuggestion(
    suggestionId: string,
    input: AcceptOpenworkMemorySuggestionInput
  ): Promise<OpenworkMemoryRecord> {
    return this.acceptSuggestionForCurrentWorkspace(suggestionId, input)
  }

  rejectSuggestion(suggestionId: string): Promise<OpenworkMemorySuggestionRecord> {
    return this.rejectSuggestionForCurrentWorkspace(suggestionId)
  }

  updateMemory(memoryId: string, input: UpdateOpenworkMemoryInput): Promise<OpenworkMemoryRecord> {
    return this.updateMemoryForCurrentWorkspace(memoryId, input)
  }

  async archiveMemory(memoryId: string): Promise<OpenworkMemoryRecord> {
    await this.assertMemoryMutableFromCurrentWorkspace(memoryId)
    return archiveAgentMemory(memoryId)
  }

  async deleteMemory(memoryId: string): Promise<void> {
    await this.assertMemoryMutableFromCurrentWorkspace(memoryId)
    return deleteAgentMemory(memoryId)
  }

  hasPendingWorkspaceSuggestions(threadId: string): Promise<boolean> {
    return hasPendingWorkspaceMemorySuggestions(threadId)
  }

  recordInclusions(input: { memoryIds: string[]; runId: string; threadId: string }): Promise<void> {
    return recordAgentMemoryInclusions(input)
  }

  listIncludedMemoriesForRun(runId: string): Promise<OpenworkMemoryInclusionRecord[]> {
    return listAgentMemoryInclusionsForRun(runId)
  }

  private async requireCurrentWorkspaceIdentity(): Promise<OpenworkWorkspaceIdentity> {
    const workspaceIdentity = await this.getCurrentWorkspaceIdentity()
    if (!workspaceIdentity) {
      throw new Error("Workspace-scoped memory requires a current workspace.")
    }

    return workspaceIdentity
  }

  private async resolveThreadOrCurrentWorkspaceIdentity(
    threadId: string | null
  ): Promise<OpenworkWorkspaceIdentity> {
    const threadWorkspaceIdentity = threadId ? await this.getThreadWorkspaceIdentity(threadId) : null
    return threadWorkspaceIdentity ?? this.requireCurrentWorkspaceIdentity()
  }

  private assertWorkspaceKeyMatches(input: {
    actualWorkspaceKey: string | null
    expectedWorkspaceKey: string | null
    label: string
  }): void {
    if (input.actualWorkspaceKey !== input.expectedWorkspaceKey) {
      throw new Error(`${input.label} does not belong to the current workspace.`)
    }
  }

  private async assertMemoryMutableFromCurrentWorkspace(
    memoryId: string
  ): Promise<OpenworkMemoryRecord> {
    const memory = await getAgentMemory(memoryId)
    if (!memory) {
      throw new Error(`Unknown memory "${memoryId}"`)
    }

    if (memory.scope === "workspace") {
      const workspaceIdentity = await this.requireCurrentWorkspaceIdentity()
      this.assertWorkspaceKeyMatches({
        actualWorkspaceKey: memory.workspaceKey,
        expectedWorkspaceKey: workspaceIdentity.workspaceKey,
        label: "Memory"
      })
    }

    return memory
  }

  private async assertSuggestionMutableFromCurrentWorkspace(
    suggestionId: string
  ): Promise<OpenworkMemorySuggestionRecord> {
    const suggestion = await getAgentMemorySuggestion(suggestionId)
    if (!suggestion) {
      throw new Error(`Unknown memory suggestion "${suggestionId}"`)
    }

    if (suggestion.scope === "workspace") {
      const workspaceIdentity = await this.resolveThreadOrCurrentWorkspaceIdentity(
        suggestion.threadId
      )
      this.assertWorkspaceKeyMatches({
        actualWorkspaceKey: suggestion.workspaceKey,
        expectedWorkspaceKey: workspaceIdentity.workspaceKey,
        label: "Memory suggestion"
      })
    }

    return suggestion
  }

  private async listSuggestionsForCurrentWorkspace(
    input: ListOpenworkSuggestionsInput
  ): Promise<OpenworkMemorySuggestionRecord[]> {
    const workspaceIdentity = await this.getCurrentWorkspaceIdentity()
    const threadWorkspaceIdentity = input.threadId
      ? await this.getThreadWorkspaceIdentity(input.threadId)
      : null
    return listAgentMemorySuggestions({
      ...input,
      workspaceKey: threadWorkspaceIdentity?.workspaceKey ?? workspaceIdentity?.workspaceKey ?? null
    })
  }

  private async createSuggestionForWorkspace(
    input: CreateOpenworkMemorySuggestionInput,
    workspaceIdentity?: OpenworkWorkspaceIdentity
  ): Promise<OpenworkMemorySuggestionRecord> {
    const resolvedWorkspaceIdentity =
      input.scope === "workspace"
        ? workspaceIdentity ?? (await this.requireCurrentWorkspaceIdentity())
        : null

    return createAgentMemorySuggestion({
      ...input,
      workspaceKey: resolvedWorkspaceIdentity?.workspaceKey ?? null
    })
  }

  private async acceptSuggestionForCurrentWorkspace(
    suggestionId: string,
    input: AcceptOpenworkMemorySuggestionInput
  ): Promise<OpenworkMemoryRecord> {
    const suggestion = await this.assertSuggestionMutableFromCurrentWorkspace(suggestionId)
    if (input.scope === "workspace" && suggestion.scope !== "workspace") {
      const workspaceIdentity = await this.requireCurrentWorkspaceIdentity()
      return acceptAgentMemorySuggestion(suggestionId, {
        ...input,
        workspaceKey: workspaceIdentity.workspaceKey
      })
    }

    return acceptAgentMemorySuggestion(suggestionId, input)
  }

  private async rejectSuggestionForCurrentWorkspace(
    suggestionId: string
  ): Promise<OpenworkMemorySuggestionRecord> {
    await this.assertSuggestionMutableFromCurrentWorkspace(suggestionId)
    return rejectAgentMemorySuggestion(suggestionId)
  }

  private async updateMemoryForCurrentWorkspace(
    memoryId: string,
    input: UpdateOpenworkMemoryInput
  ): Promise<OpenworkMemoryRecord> {
    const memory = await this.assertMemoryMutableFromCurrentWorkspace(memoryId)
    const workspaceIdentity =
      input.scope === "workspace" && memory.scope !== "workspace"
        ? await this.requireCurrentWorkspaceIdentity()
        : null

    return updateAgentMemory(memoryId, {
      ...input,
      ...(workspaceIdentity ? { workspaceKey: workspaceIdentity.workspaceKey } : {})
    })
  }
}
