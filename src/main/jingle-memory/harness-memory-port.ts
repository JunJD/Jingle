import type {
  AgentContextInclusion,
  JingleMemoryEvidenceRef,
  JingleMemoryContextItem,
  JingleMemoryContextPack,
  JingleMemoryScope,
  JingleMemoryType,
  JingleWorkspaceIdentity
} from "@shared/jingle-memory"
import type { RuntimeMemoryConfig } from "@jingle/langchain-agent-harness"
import type { JingleMemoryService } from "./service"

export type JingleMemoryHarnessPortOptions = RuntimeMemoryConfig<AgentContextInclusion>

export interface CreateJingleMemoryHarnessPortOptions {
  allowSuggestions: boolean
  contextPack: JingleMemoryContextPack | null
  service: JingleMemoryService
  temporaryMode: boolean
  threadId: string
  workspaceIdentity: JingleWorkspaceIdentity
}

function buildSuggestionEvidenceRefs(
  contextInclusions: AgentContextInclusion[] | undefined
): JingleMemoryEvidenceRef[] {
  const refs: JingleMemoryEvidenceRef[] = []
  const seenIds = new Set<string>()

  for (const inclusion of contextInclusions ?? []) {
    if (inclusion.availability !== "available" || inclusion.mode === "provided") {
      continue
    }
    if (seenIds.has(inclusion.id)) {
      continue
    }
    seenIds.add(inclusion.id)
    refs.push({
      id: inclusion.id,
      mode: inclusion.mode,
      preview: inclusion.preview,
      sourceId: inclusion.sourceId,
      sourceType: inclusion.sourceType,
      target: inclusion.target,
      threadId: inclusion.threadId,
      title: inclusion.title
    })
  }

  return refs
}

function groupItems(
  contextPack: JingleMemoryContextPack
): Record<JingleMemoryContextItem["kind"], JingleMemoryContextItem[]> {
  return {
    about_me: contextPack.items.filter((item) => item.kind === "about_me"),
    correction: contextPack.items.filter((item) => item.kind === "correction"),
    instruction_source: contextPack.items.filter((item) => item.kind === "instruction_source"),
    rules: contextPack.items.filter((item) => item.kind === "rules"),
    soul: contextPack.items.filter((item) => item.kind === "soul"),
    workspace_context: contextPack.items.filter((item) => item.kind === "workspace_context")
  }
}

function renderBulletItems(items: JingleMemoryContextItem[]): string[] {
  return items.map((item) => {
    const source = item.sourceType === "file" ? `Source: ${item.sourceLabel}. ` : ""
    return `- ${source}${item.content}`
  })
}

export function appendJingleMemorySection(
  systemPrompt: string,
  contextPack: JingleMemoryContextPack
): string {
  const grouped = groupItems(contextPack)
  const sections: string[] = []

  if (grouped.soul.length > 0) {
    sections.push(["Soul:", ...renderBulletItems(grouped.soul)].join("\n"))
  }

  const ruleItems = [...grouped.rules, ...grouped.instruction_source]
  if (ruleItems.length > 0) {
    sections.push(["Rules and instruction sources:", ...renderBulletItems(ruleItems)].join("\n"))
  }

  const personalSections: string[] = []
  if (grouped.about_me.length > 0) {
    personalSections.push(["About me:", ...renderBulletItems(grouped.about_me)].join("\n"))
  }
  if (grouped.workspace_context.length > 0) {
    personalSections.push(
      ["Current workspace:", ...renderBulletItems(grouped.workspace_context)].join("\n")
    )
  }
  if (grouped.correction.length > 0) {
    personalSections.push(["Corrections:", ...renderBulletItems(grouped.correction)].join("\n"))
  }
  if (personalSections.length > 0) {
    sections.push(["Personal memory:", ...personalSections].join("\n\n"))
  }

  if (sections.length === 0) {
    return systemPrompt
  }

  return [
    systemPrompt,
    "### Jingle memory and context",
    ...sections,
    "Use this section as background context. Current user messages override memory and context when they conflict. Do not claim a pending memory is saved until the user confirms it."
  ].join("\n\n")
}

export function createJingleMemoryHarnessPortOptions(
  options: CreateJingleMemoryHarnessPortOptions
): JingleMemoryHarnessPortOptions {
  const contextPack = options.contextPack

  return {
    applyMemoryContextToSystemPrompt: contextPack
      ? (systemPrompt) => appendJingleMemorySection(systemPrompt, contextPack)
      : undefined,
    enableSuggestionTool: options.allowSuggestions && !options.temporaryMode,
    suggestPersonalMemory: async (input, context) => {
      const evidenceRefs = buildSuggestionEvidenceRefs(context.contextInclusions)
      const evidenceIds = evidenceRefs.map((entry) => entry.id)
      await options.service.createSuggestion(
        {
          content: input.content,
          reason: input.reason ?? null,
          ...(evidenceRefs.length > 0
            ? {
                reviewPayload: {
                  evidenceIds,
                  evidenceRefs
                }
              }
            : {}),
          scope: input.scope as JingleMemoryScope,
          sourceRunId: context.runId,
          threadId: options.threadId,
          type: input.type as JingleMemoryType
        },
        options.workspaceIdentity
      )

      return "Added to Pending memories for user review. It is not saved as active memory until the user confirms it."
    }
  }
}
