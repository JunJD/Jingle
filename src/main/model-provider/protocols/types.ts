import type { ChatAnthropic } from "@langchain/anthropic"
import type { BaseChatModel } from "@langchain/core/language_models/chat_models"
import type { ChatGoogleGenerativeAI } from "@langchain/google-genai"
import type { ChatOpenAI } from "@langchain/openai"
import type { ResolvedModelRuntimeConfig } from "../types"

export type ChatModelInstance = ChatAnthropic | ChatOpenAI | ChatGoogleGenerativeAI | BaseChatModel

export interface ChatModelOptions {
  parallelToolCalls?: boolean
  temperature?: number
}

export interface ProtocolCreateModelInput {
  headers?: Record<string, string>
  runtimeConfig: ResolvedModelRuntimeConfig
  options: ChatModelOptions
}
