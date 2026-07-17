import type { AssistantContentPartsProjection } from "@shared/assistant-content-part"

export interface LoadedAssistantContentProjection {
  messageId: string
  projection: AssistantContentPartsProjection
  sourceText: string
  threadId: string
}

export function projectionForAssistantContentSource(input: {
  isStreaming: boolean
  loaded: LoadedAssistantContentProjection | null
  messageId: string
  sourceText: string
  threadId: string
}): AssistantContentPartsProjection | null {
  if (input.isStreaming) return null
  const loaded = input.loaded
  return loaded?.messageId === input.messageId &&
    loaded.sourceText === input.sourceText &&
    loaded.threadId === input.threadId
    ? loaded.projection
    : null
}
