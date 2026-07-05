export function modelSupportsReasoning(modelId: string): boolean {
  const normalized = modelId.toLowerCase()

  return (
    /^o\d/.test(normalized) ||
    normalized.includes("reasoner") ||
    normalized.includes("reasoning") ||
    normalized.includes("thinking") ||
    normalized.includes("gpt-5") ||
    normalized.includes("claude-4") ||
    normalized.includes("claude-opus-4") ||
    normalized.includes("claude-sonnet-4") ||
    normalized.includes("deepseek-v4") ||
    normalized.includes("gemini-2.5") ||
    normalized.includes("gemini-3") ||
    normalized.startsWith("qwq-")
  )
}
