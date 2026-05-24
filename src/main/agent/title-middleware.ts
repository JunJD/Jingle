import { AIMessage, HumanMessage, type BaseMessage } from "@langchain/core/messages"
import { createMiddleware } from "langchain"
import { z } from "zod/v4"
import { getChatModelInstance } from "../llm/get-chat-model"

const MAX_TITLE_CHARS = 60
const FALLBACK_TITLE_CHARS = 50
const TITLE_GENERATION_TIMEOUT_MS = 2_500

const titleStateSchema = z.object({
  title: z.string().nullable().optional()
})

type TitleState = {
  messages: BaseMessage[]
  title?: string | null
}

interface CreateTitleMiddlewareOptions {
  generateTitle?: (state: TitleState) => Promise<string | null>
}

function normalizeContent(content: BaseMessage["content"]): string {
  if (typeof content === "string") {
    return content
  }

  return content
    .map((block) => {
      if (typeof block === "string") {
        return block
      }

      if (block && typeof block === "object" && "text" in block && typeof block.text === "string") {
        return block.text
      }

      if (
        block &&
        typeof block === "object" &&
        "content" in block &&
        typeof block.content === "string"
      ) {
        return block.content
      }

      return ""
    })
    .filter(Boolean)
    .join("\n")
}

function stripThinkTags(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim()
}

function parseTitle(content: BaseMessage["content"]): string {
  const title = stripThinkTags(normalizeContent(content)).replace(/^["']|["']$/g, "").trim()
  return title.length > MAX_TITLE_CHARS ? title.slice(0, MAX_TITLE_CHARS) : title
}

function fallbackTitle(userMessage: string): string {
  const cleaned = userMessage.trim().replace(/\s+/g, " ")
  if (!cleaned) {
    return "New Conversation"
  }

  return cleaned.length > FALLBACK_TITLE_CHARS
    ? `${cleaned.slice(0, FALLBACK_TITLE_CHARS).trimEnd()}...`
    : cleaned
}

function shouldGenerateTitle(state: TitleState): boolean {
  if (state.title) {
    return false
  }

  const userMessages = state.messages.filter((message) => HumanMessage.isInstance(message))
  const assistantMessages = state.messages.filter((message) => AIMessage.isInstance(message))

  if (userMessages.length !== 1 || assistantMessages.length < 1) {
    return false
  }

  const latestAssistantMessage = assistantMessages.at(-1)
  return latestAssistantMessage ? !hasPendingToolCalls(latestAssistantMessage) : false
}

function hasPendingToolCalls(message: BaseMessage): boolean {
  const toolCallMessage = message as BaseMessage & {
    additional_kwargs?: { tool_calls?: unknown[] }
    tool_call_chunks?: unknown[]
    tool_calls?: unknown[]
  }

  if (Array.isArray(toolCallMessage.tool_calls) && toolCallMessage.tool_calls.length > 0) {
    return true
  }

  if (
    Array.isArray(toolCallMessage.tool_call_chunks) &&
    toolCallMessage.tool_call_chunks.length > 0
  ) {
    return true
  }

  return (
    Array.isArray(toolCallMessage.additional_kwargs?.tool_calls) &&
    toolCallMessage.additional_kwargs.tool_calls.length > 0
  )
}

function buildTitlePrompt(state: TitleState): { prompt: string; userMessage: string } {
  const userMessage = normalizeContent(
    state.messages.find((message) => HumanMessage.isInstance(message))?.content ?? ""
  )
  const assistantMessage = stripThinkTags(
    normalizeContent(
      state.messages.find((message) => AIMessage.isInstance(message))?.content ?? ""
    )
  )

  return {
    prompt: [
      "Generate a concise title for this conversation.",
      "Maximum 6 words, or 18 Chinese characters.",
      "Return only the title. Do not include quotes or explanation.",
      "",
      `User: ${userMessage.slice(0, 500)}`,
      `Assistant: ${assistantMessage.slice(0, 500)}`
    ].join("\n"),
    userMessage
  }
}

async function generateAiTitle(state: TitleState): Promise<string | null> {
  const { prompt, userMessage } = buildTitlePrompt(state)

  try {
    const model = getChatModelInstance({
      modelPreference: "fast",
      temperature: 0
    })
    const response = await model.withConfig({ runName: "thread_title" }).invoke(
      [new HumanMessage(prompt)],
      { timeout: TITLE_GENERATION_TIMEOUT_MS }
    )
    const title = parseTitle(response.content)
    return title || fallbackTitle(userMessage)
  } catch (error) {
    console.debug("[TitleMiddleware] Failed to generate title; using fallback.", error)
    return fallbackTitle(userMessage)
  }
}

export function createTitleMiddleware(options: CreateTitleMiddlewareOptions = {}) {
  const generateTitle = options.generateTitle ?? generateAiTitle

  return createMiddleware({
    name: "TitleMiddleware",
    stateSchema: titleStateSchema,
    afterModel: async (state) => {
      if (!shouldGenerateTitle(state)) {
        return undefined
      }

      const title = await generateTitle(state)
      return title ? { title } : undefined
    }
  })
}

export const titleMiddlewareInternals = {
  buildTitlePrompt,
  fallbackTitle,
  normalizeContent,
  parseTitle,
  shouldGenerateTitle,
  hasPendingToolCalls,
  stripThinkTags
}
