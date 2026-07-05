import type { BaseChatModel } from "@langchain/core/language_models/chat_models"
import type { ConfigurableModel } from "langchain/chat_models/universal"

export function isBaseChatModel(model: unknown): model is BaseChatModel {
  return (
    typeof model === "object" &&
    model !== null &&
    "invoke" in model &&
    typeof model.invoke === "function" &&
    "_streamResponseChunks" in model
  )
}

export function isConfigurableModel(model: unknown): model is ConfigurableModel {
  return (
    typeof model === "object" &&
    model != null &&
    "_queuedMethodOperations" in model &&
    "_getModelInstance" in model &&
    typeof model._getModelInstance === "function"
  )
}
