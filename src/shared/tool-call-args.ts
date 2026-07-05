export function parseCompleteToolCallArgsObject(argsText: string): Record<string, unknown> | null {
  if (!argsText.trim()) {
    return null
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(argsText) as unknown
  } catch (error) {
    if (error instanceof SyntaxError) {
      return null
    }

    throw error
  }

  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : null
}
