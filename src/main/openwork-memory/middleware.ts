import { createMiddleware, tool, type AgentMiddleware, type ToolRuntime } from "langchain"
import { z } from "zod/v4"
import type {
  OpenworkMemoryContextItem,
  OpenworkMemoryContextPack,
  OpenworkMemoryScope,
  OpenworkMemoryType,
  OpenworkWorkspaceIdentity
} from "@shared/openwork-memory"
import { getRunIdFromToolRuntime } from "../agent/run-config"
import type { OpenworkMemoryService } from "./service"

export interface OpenworkMemoryRuntime {
  middleware: AgentMiddleware
}

export interface OpenworkMemoryInclusionCollector {
  getIncludedStructuredMemoryIds(): string[]
  markContextPackIncluded(contextPack: OpenworkMemoryContextPack): void
}

export function createOpenworkMemoryInclusionCollector(): OpenworkMemoryInclusionCollector {
  const includedStructuredMemoryIds = new Set<string>()

  return {
    getIncludedStructuredMemoryIds: () => Array.from(includedStructuredMemoryIds),
    markContextPackIncluded: (contextPack) => {
      for (const item of contextPack.items) {
        if (item.structuredMemoryId) {
          includedStructuredMemoryIds.add(item.structuredMemoryId)
        }
      }
    }
  }
}

export interface CreateOpenworkMemoryMiddlewareOptions {
  collector: OpenworkMemoryInclusionCollector
  allowSuggestions: boolean
  contextPack: OpenworkMemoryContextPack | null
  mode: "root" | "subagent"
  runId: string
  service: OpenworkMemoryService
  temporaryMode: boolean
  threadId: string
  workspaceIdentity: OpenworkWorkspaceIdentity
}

const suggestPersonalMemorySchema = z
  .object({
    content: z.string().trim().min(1),
    reason: z.string().trim().optional(),
    scope: z.enum(["global", "workspace"]),
    type: z.enum(["about_me", "workspace_context", "correction"])
  })
  .strict()

function groupItems(
  contextPack: OpenworkMemoryContextPack
): Record<OpenworkMemoryContextItem["kind"], OpenworkMemoryContextItem[]> {
  return {
    about_me: contextPack.items.filter((item) => item.kind === "about_me"),
    correction: contextPack.items.filter((item) => item.kind === "correction"),
    instruction_source: contextPack.items.filter((item) => item.kind === "instruction_source"),
    rules: contextPack.items.filter((item) => item.kind === "rules"),
    soul: contextPack.items.filter((item) => item.kind === "soul"),
    workspace_context: contextPack.items.filter((item) => item.kind === "workspace_context")
  }
}

function renderBulletItems(items: OpenworkMemoryContextItem[]): string[] {
  return items.map((item) => {
    const source = item.sourceType === "file" ? `Source: ${item.sourceLabel}. ` : ""
    return `- ${source}${item.content}`
  })
}

export function appendOpenworkMemorySection(
  systemPrompt: string,
  contextPack: OpenworkMemoryContextPack
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
    "### Openwork memory and context",
    ...sections,
    "Use this section as background context. Current user messages override memory and context when they conflict. Do not claim a pending memory is saved until the user confirms it."
  ].join("\n\n")
}

export function createOpenworkMemoryMiddleware(
  options: CreateOpenworkMemoryMiddlewareOptions
): OpenworkMemoryRuntime {
  const suggestPersonalMemoryTool =
    options.mode === "root" && options.allowSuggestions
      ? tool(
          async (input, runtime: ToolRuntime) => {
            const parsed = suggestPersonalMemorySchema.parse(input)
            await options.service.createSuggestion(
              {
                content: parsed.content,
                reason: parsed.reason ?? null,
                scope: parsed.scope as OpenworkMemoryScope,
                sourceRunId: getRunIdFromToolRuntime(runtime) ?? options.runId,
                threadId: options.threadId,
                type: parsed.type as OpenworkMemoryType
              },
              options.workspaceIdentity
            )

            return "Added to Pending memories for user review. It is not saved as active memory until the user confirms it."
          },
          {
            description:
              "Suggest a durable personal memory only when the user explicitly asks to remember something, corrects a reusable behavior, or confirms stable current-workspace context. This creates a pending suggestion, not an active memory.",
            name: "suggest_personal_memory",
            schema: suggestPersonalMemorySchema
          }
        )
      : null

  const middleware = createMiddleware({
    name: "openworkMemory",
    ...(suggestPersonalMemoryTool ? { tools: [suggestPersonalMemoryTool] } : {}),
    wrapModelCall: async (request, handler) => {
      if (!options.contextPack) {
        return handler(request)
      }

      options.collector.markContextPackIncluded(options.contextPack)

      return handler({
        ...request,
        systemPrompt: appendOpenworkMemorySection(request.systemPrompt, options.contextPack)
      })
    }
  })

  return {
    middleware
  }
}
