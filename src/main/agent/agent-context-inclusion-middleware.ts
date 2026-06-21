import { ToolMessage } from "@langchain/core/messages"
import { Command, ReducedValue, StateSchema } from "@langchain/langgraph"
import { createMiddleware, tool, type ToolRuntime } from "langchain"
import { z } from "zod/v4"
import {
  AGENT_CONTEXT_AVAILABILITIES,
  AGENT_CONTEXT_INCLUSION_MODES,
  AGENT_CONTEXT_SOURCE_TYPES,
  AGENT_CONTEXT_UNAVAILABLE_CODES,
  OPENWORK_MEMORY_SCOPES,
  OPENWORK_MEMORY_TYPES,
  createRetrievedMemoryContextInclusion,
  createRetrievedMessageContextInclusion,
  upsertAgentContextInclusions,
  type AgentContextInclusion,
  type OpenworkMemoryRecord,
  type OpenworkWorkspaceIdentity
} from "@shared/openwork-memory"
import { extractMessageText } from "@shared/message-content"
import { listProjectedThreadMessages, type MessageProjectionRow } from "../db/message-state"
import type { OpenworkMemoryService } from "../openwork-memory/service"
import { getRunIdFromToolRuntime } from "./run-config"

type ContextInclusionToolState = {
  contextInclusions?: AgentContextInclusion[]
}

const TOOL_CONTEXT_CONTENT_LIMIT = 4_000

const agentContextJumpTargetSchema = z
  .object({
    artifactId: z.string().optional(),
    memoryId: z.string().optional(),
    messageId: z.string().optional(),
    path: z.string().optional(),
    runId: z.string().optional(),
    threadId: z.string().optional(),
    traceId: z.string().optional(),
    traceStepId: z.string().optional(),
    type: z.enum(AGENT_CONTEXT_SOURCE_TYPES)
  })
  .strict()

const agentContextUnavailableReasonSchema = z
  .object({
    code: z.enum(AGENT_CONTEXT_UNAVAILABLE_CODES),
    message: z.string()
  })
  .strict()

const agentContextInclusionSchema = z
  .object({
    availability: z.enum(AGENT_CONTEXT_AVAILABILITIES),
    createdAt: z.number(),
    id: z.string(),
    messageId: z.string().nullable(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    mode: z.enum(AGENT_CONTEXT_INCLUSION_MODES),
    preview: z.string(),
    runId: z.string(),
    sourceId: z.string(),
    sourceType: z.enum(AGENT_CONTEXT_SOURCE_TYPES),
    target: agentContextJumpTargetSchema,
    threadId: z.string(),
    title: z.string(),
    turnId: z.string().nullable(),
    unavailableReason: agentContextUnavailableReasonSchema.optional()
  })
  .strict()

const agentContextInclusionsSchema = z.array(agentContextInclusionSchema).default(() => [])
const agentContextInclusionsUpdateSchema = z.array(agentContextInclusionSchema).optional()

const agentContextInclusionStateSchema = new StateSchema({
  contextInclusions: new ReducedValue(agentContextInclusionsSchema, {
    inputSchema: agentContextInclusionsUpdateSchema,
    reducer: (existing, update) =>
      update ? upsertAgentContextInclusions(existing, update) : existing
  })
})

const searchMemorySchema = z
  .object({
    limit: z.number().int().min(1).max(8).optional(),
    query: z.string().trim().min(1),
    scope: z.enum(OPENWORK_MEMORY_SCOPES).optional(),
    type: z.enum(OPENWORK_MEMORY_TYPES).optional()
  })
  .strict()

const getMessageContextSchema = z
  .object({
    messageId: z.string().trim().min(1)
  })
  .strict()

interface CreateAgentContextInclusionMiddlewareOptions {
  allowMemorySearch: boolean
  memoryService: OpenworkMemoryService | null
  runId: string
  threadId: string
  workspaceIdentity: OpenworkWorkspaceIdentity
}

function getExistingContextInclusions(runtime: ToolRuntime<ContextInclusionToolState>) {
  return runtime.state.contextInclusions ?? []
}

function readProjectedMessageText(message: MessageProjectionRow): string {
  let content: unknown = message.content
  try {
    content = JSON.parse(message.content) as unknown
  } catch {
    content = message.content
  }

  const text =
    typeof content === "string" || Array.isArray(content) ? extractMessageText(content) : ""
  return text.trim() || message.content
}

function clipToolContextContent(content: string): string {
  const trimmed = content.trim()
  return trimmed.length > TOOL_CONTEXT_CONTENT_LIMIT
    ? `${trimmed.slice(0, TOOL_CONTEXT_CONTENT_LIMIT)}\n[truncated]`
    : trimmed
}

function formatRetrievedMessageToolContent(input: {
  message: MessageProjectionRow
  text: string
}): string {
  return [
    "Retrieved message context:",
    `id: ${input.message.message_id}`,
    `role: ${input.message.role}`,
    "",
    clipToolContextContent(input.text)
  ].join("\n")
}

function formatRetrievedMemoryToolContent(memories: OpenworkMemoryRecord[]): string {
  return [
    "Retrieved memory context:",
    ...memories.map((memory, index) =>
      [
        `[${index + 1}] ${memory.scope}/${memory.type} (${memory.memoryId})`,
        clipToolContextContent(memory.content)
      ].join("\n")
    )
  ].join("\n\n")
}

function createToolMessage(input: {
  content: string
  name: string
  runtime: ToolRuntime<ContextInclusionToolState>
}): ToolMessage {
  return new ToolMessage({
    content: input.content,
    name: input.name,
    tool_call_id: input.runtime.toolCallId
  })
}

export function createAgentContextInclusionMiddleware(
  options: CreateAgentContextInclusionMiddlewareOptions
) {
  const getMessageContextTool = tool(
    async (input, runtime: ToolRuntime<ContextInclusionToolState>) => {
      const parsed = getMessageContextSchema.parse(input)
      const targetThreadId = options.threadId
      const messages = await listProjectedThreadMessages(targetThreadId)
      const message = messages.find((entry) => entry.message_id === parsed.messageId)

      if (!message) {
        throw new Error(`Message context not found: ${parsed.messageId}`)
      }

      const runId = getRunIdFromToolRuntime(runtime) ?? options.runId
      const messageText = readProjectedMessageText(message)
      const inclusion = createRetrievedMessageContextInclusion({
        createdAt: Date.now(),
        message: {
          content: messageText,
          id: message.message_id,
          role: message.role,
          threadId: targetThreadId
        },
        runId,
        threadId: options.threadId
      })
      const contextInclusions = upsertAgentContextInclusions(
        getExistingContextInclusions(runtime),
        [inclusion]
      )

      return new Command({
        update: {
          contextInclusions,
          messages: [
            createToolMessage({
              content: formatRetrievedMessageToolContent({
                message,
                text: messageText
              }),
              name: "get_message_context",
              runtime
            })
          ]
        }
      })
    },
    {
      description:
        "Retrieve a specific prior message as explicit context evidence. This records a retrieved history_message in runtime context state when the message exists.",
      name: "get_message_context",
      schema: getMessageContextSchema
    }
  )

  const memoryService = options.memoryService
  const searchMemoryTool =
    options.allowMemorySearch && memoryService
      ? tool(
          async (input, runtime: ToolRuntime<ContextInclusionToolState>) => {
            const parsed = searchMemorySchema.parse(input)
            const memories = await memoryService.searchMemoriesForContext(
              {
                limit: parsed.limit,
                query: parsed.query,
                scope: parsed.scope,
                type: parsed.type
              },
              options.workspaceIdentity
            )

            if (memories.length === 0) {
              return "No matching memories found."
            }

            const runId = getRunIdFromToolRuntime(runtime) ?? options.runId
            const createdAt = Date.now()
            const inclusions = memories.map((memory) =>
              createRetrievedMemoryContextInclusion({
                createdAt,
                memory,
                runId,
                threadId: options.threadId
              })
            )
            const contextInclusions = upsertAgentContextInclusions(
              getExistingContextInclusions(runtime),
              inclusions
            )

            return new Command({
              update: {
                contextInclusions,
                messages: [
                  createToolMessage({
                    content: formatRetrievedMemoryToolContent(memories),
                    name: "search_memory",
                    runtime
                  })
                ]
              }
            })
          },
          {
            description:
              "Search saved active personal/workspace memories and add matching results to runtime context state. Use this when the current answer needs remembered facts beyond the provided context pack.",
            name: "search_memory",
            schema: searchMemorySchema
          }
        )
      : null

  return createMiddleware({
    name: "agentContextInclusions",
    stateSchema: agentContextInclusionStateSchema,
    tools: searchMemoryTool ? [searchMemoryTool, getMessageContextTool] : [getMessageContextTool]
  })
}

export const agentContextInclusionMiddlewareInternals = {
  formatRetrievedMemoryToolContent,
  formatRetrievedMessageToolContent
}
