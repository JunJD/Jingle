import type {
  ExtensionRunBotAgentPayload,
  ExtensionRunBotAgentSourceRef
} from "@shared/extension-runtime-protocol"

export interface RunBotAgentSourceProjection {
  label: string
  title: string
  url: string | null
}

function validateOptionalSourceField(field: string, value: string | undefined): void {
  if (value !== undefined && value.trim().length === 0) {
    throw new Error(`Run Bot Agent source ${field} must be non-empty when declared`)
  }
}

export function projectRunBotAgentSource(
  source: ExtensionRunBotAgentSourceRef
): RunBotAgentSourceProjection {
  if (source.type.trim().length === 0) {
    throw new Error("Run Bot Agent source type must be non-empty")
  }
  validateOptionalSourceField("id", source.id)
  validateOptionalSourceField("url", source.url)
  if (source.label.trim().length === 0) {
    throw new Error("Run Bot Agent source label must be non-empty")
  }

  return {
    label: source.label,
    title: source.url ?? source.label,
    url: source.url ?? null
  }
}

export function projectRunBotAgentPrompt(input: ExtensionRunBotAgentPayload): string {
  const lines = [input.prompt.objective, "", "Context:", `- Title: ${input.title}`]

  if (input.sourceRef !== undefined) {
    const source = projectRunBotAgentSource(input.sourceRef)
    lines.push(`- Source: ${source.label}${source.url === null ? "" : ` (${source.url})`}`)
  }

  const status = input.workflow?.status
  const labels = input.workflow?.labels
  if (status !== undefined || (labels !== undefined && labels.length > 0)) {
    const classification: string[] = []
    if (status !== undefined) {
      classification.push(`status=${status}`)
    }
    if (labels !== undefined && labels.length > 0) {
      classification.push(
        `labels=${labels
          .map((label) => (label.value === undefined ? label.key : `${label.key}=${label.value}`))
          .join(", ")}`
      )
    }
    lines.push(`- Work classification: ${classification.join("; ")}`)
  }

  const contextRefs = input.prompt.contextRefs
  if (contextRefs !== undefined && contextRefs.length > 0) {
    lines.push("", "References:")
    for (const ref of contextRefs) {
      const source = projectRunBotAgentSource(ref)
      lines.push(`- ${source.label}${source.url === null ? "" : `: ${source.url}`}`)
    }
  }

  const skillRefs = input.prompt.skillRefs
  if (skillRefs !== undefined && skillRefs.length > 0) {
    lines.push("", `Skills: ${skillRefs.join(", ")}`)
  }

  const instructions = input.prompt.instructions
  if (instructions !== undefined && instructions.length > 0) {
    lines.push("", "Instructions:")
    for (const instruction of instructions) {
      lines.push(`- ${instruction}`)
    }
  }

  return lines.join("\n").trim()
}
