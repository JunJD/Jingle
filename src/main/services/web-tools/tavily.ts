import { tavily, type TavilyClient } from "@tavily/core"
import { getEnvValue } from "../../storage"

export function getTavilyClient(): TavilyClient | null {
  const apiKey = getEnvValue("TAVILY_API_KEY")?.trim()
  if (!apiKey) {
    return null
  }

  return tavily({
    apiKey,
    clientSource: "jingle"
  })
}

export function toTavilyTimeoutSeconds(timeoutMs: number): number {
  return Math.max(1, Math.ceil(timeoutMs / 1000))
}
