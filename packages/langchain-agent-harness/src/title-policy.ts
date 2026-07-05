import { AIMessage, HumanMessage, type BaseMessage } from "@langchain/core/messages"
import {
  hasJingleLangChainToolCallSignal,
  readJingleLangChainMessageText
} from "./langchain-message-reader"

export interface JingleTitlePolicyState {
  messages: BaseMessage[]
  title?: string | null
}

const JINGLE_MAX_TITLE_CHARS = 60

export function stripJingleTitleThinkTags(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim()
}

export function parseJingleGeneratedTitle(content: BaseMessage["content"]): string {
  const title = stripJingleTitleThinkTags(readJingleLangChainMessageText(content))
    .replace(/^["']|["']$/g, "")
    .trim()
  return title.length > JINGLE_MAX_TITLE_CHARS ? title.slice(0, JINGLE_MAX_TITLE_CHARS) : title
}

export function shouldGenerateJingleTitle(state: JingleTitlePolicyState): boolean {
  if (state.title) {
    return false
  }

  const latestAssistantIndex = state.messages.findLastIndex((message) =>
    AIMessage.isInstance(message)
  )
  if (latestAssistantIndex === -1) {
    return false
  }

  const latestUserIndex = state.messages.findLastIndex((message) => HumanMessage.isInstance(message))
  if (latestUserIndex === -1 || latestUserIndex > latestAssistantIndex) {
    return false
  }

  const latestAssistantMessage = state.messages[latestAssistantIndex]
  return !hasJingleLangChainToolCallSignal(latestAssistantMessage)
}

export function buildJingleTitlePrompt(state: JingleTitlePolicyState): {
  prompt: string
  system: string
} {
  const userMessage = readJingleLangChainMessageText(
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
