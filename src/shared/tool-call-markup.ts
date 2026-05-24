export interface ToolCallMarkupArgument {
  name: string
  value: unknown
}

export interface ToolCallMarkupCall {
  args: Record<string, unknown>
  end: number
  name: string
  raw: string
  start: number
}

export interface ParseToolCallMarkupOptions {
  availableToolNames?: ReadonlySet<string> | readonly string[]
  parseArgumentValue?: (input: {
    rawValue: string
    toolName: string
    parameterName: string
  }) => unknown
}

const toolCallPattern = /<function=([^>\s]+)>([\s\S]*?)<\/tool_call>/g
const toolParameterPattern = /<parameter=([^>\s]+)>([\s\S]*?)(?=<parameter=[^>\s]+>|$)/g

function toToolNameSet(
  toolNames: ParseToolCallMarkupOptions["availableToolNames"]
): ReadonlySet<string> | null {
  if (!toolNames) {
    return null
  }

  return toolNames instanceof Set ? toolNames : new Set(toolNames)
}

function normalizeMarkupText(text: string): string {
  return text
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

function parseToolArgs(
  toolName: string,
  body: string,
  parseArgumentValue?: ParseToolCallMarkupOptions["parseArgumentValue"]
): Record<string, unknown> {
  const args: Record<string, unknown> = {}

  for (const match of body.matchAll(toolParameterPattern)) {
    const [, rawName, rawValue] = match
    const parameterName = rawName.trim()
    const value = rawValue.trim()
    args[parameterName] = parseArgumentValue
      ? parseArgumentValue({ parameterName, rawValue: value, toolName })
      : value
  }

  return args
}

export function parseToolCallMarkup(
  text: string,
  options: ParseToolCallMarkupOptions = {}
): ToolCallMarkupCall[] {
  const availableToolNames = toToolNameSet(options.availableToolNames)
  const calls: ToolCallMarkupCall[] = []

  for (const match of text.matchAll(toolCallPattern)) {
    const [raw, rawName, body] = match
    const name = rawName.trim()
    if (availableToolNames && !availableToolNames.has(name)) {
      continue
    }

    calls.push({
      args: parseToolArgs(name, body, options.parseArgumentValue),
      end: (match.index ?? 0) + raw.length,
      name,
      raw,
      start: match.index ?? 0
    })
  }

  return calls
}

export function stripToolCallMarkup(text: string, calls: readonly ToolCallMarkupCall[]): string {
  if (calls.length === 0) {
    return normalizeMarkupText(text)
  }

  const orderedCalls = [...calls].sort((left, right) => left.start - right.start)
  let stripped = ""
  let cursor = 0

  for (const call of orderedCalls) {
    stripped += text.slice(cursor, call.start)
    cursor = call.end
  }

  stripped += text.slice(cursor)
  return normalizeMarkupText(stripped)
}
