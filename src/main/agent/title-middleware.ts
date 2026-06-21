import { AIMessage, HumanMessage, SystemMessage, type BaseMessage } from "@langchain/core/messages"
import { createMiddleware } from "langchain"
import { z } from "zod/v4"
import { getChatModelInstance } from "../llm/get-chat-model"

const MAX_TITLE_CHARS = 60
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
  const title = stripThinkTags(normalizeContent(content))
    .replace(/^["']|["']$/g, "")
    .trim()
  return title.length > MAX_TITLE_CHARS ? title.slice(0, MAX_TITLE_CHARS) : title
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
  return latestAssistantMessage ? !hasTitleBlockingToolCallSignal(latestAssistantMessage) : false
}

function hasTitleBlockingToolCallSignal(message: BaseMessage): boolean {
  const observedMessage = message as BaseMessage & {
    additional_kwargs?: { tool_calls?: unknown[] }
    tool_call_chunks?: unknown[]
    tool_calls?: unknown[]
  }

  if (Array.isArray(observedMessage.tool_calls) && observedMessage.tool_calls.length > 0) {
    return true
  }

  if (
    Array.isArray(observedMessage.tool_call_chunks) &&
    observedMessage.tool_call_chunks.length > 0
  ) {
    return true
  }

  return (
    Array.isArray(observedMessage.additional_kwargs?.tool_calls) &&
    observedMessage.additional_kwargs.tool_calls.length > 0
  )
}

function buildTitlePrompt(state: TitleState): { prompt: string; system: string } {
  const userMessage = normalizeContent(
    state.messages.find((message) => HumanMessage.isInstance(message))?.content ?? ""
  )

  return {
    system: [
      "Generate a short title that describes the topic of the user's message.",
      "Use four English words or fewer, or 18 Chinese characters or fewer.",
      "Reply with only the title. Do not include quotes, explanation, or reasoning."
    ].join(" "),
    prompt: ["---BEGIN USER MESSAGE---", userMessage.slice(0, 1000), "---END USER MESSAGE---"].join(
      "\n"
    )
  }
}

async function generateAiTitle(state: TitleState): Promise<string | null> {
  const { prompt, system } = buildTitlePrompt(state)

  try {
    const model = getChatModelInstance({
      modelPreference: "fast",
      temperature: 0,
      thinkingEffort: "off"
    })
    const response = await model
      .withConfig({ runName: "thread_title" })
      .invoke([new SystemMessage(system), new HumanMessage(prompt)], {
        timeout: TITLE_GENERATION_TIMEOUT_MS
      })
    const title = parseTitle(response.content)
    return title || null
  } catch (error) {
    console.warn("[TitleMiddleware] Failed to generate title.", error)
    return null
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
  normalizeContent,
  parseTitle,
  shouldGenerateTitle,
  hasTitleBlockingToolCallSignal,
  stripThinkTags
}
