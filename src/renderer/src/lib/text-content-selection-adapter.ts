import type { ContentCardIdentity } from "@shared/content-card"
import type { ContentSelectionDraft } from "@shared/content-selection"
import type { ComposerMessageRef } from "@shared/message-content"
import { projectNarrativeContentCardIdentity } from "./content-card-registry"

type AssistantSelectionRef = Extract<ComposerMessageRef, { type: "assistant-message-selection" }>

export interface TextSelectionCapture {
  anchorResolution: "pending-stream" | "resolved"
  blockId: string
  contextHash: string
  end: number
  quote: string
  start: number
}

export function createNarrativeContentCardIdentity(input: {
  blockId: string
  messageId: string
  revision: string
  text: string
  threadId: string
}): ContentCardIdentity {
  return projectNarrativeContentCardIdentity(input)
}

export function createTextContentSelectionDraft(
  card: ContentCardIdentity,
  capture: TextSelectionCapture
): ContentSelectionDraft {
  if (card.kind !== "narrative") {
    throw new Error("[ContentSelection] Text selections require a narrative card.")
  }
  return {
    anchor: {
      blockId: capture.blockId,
      end: capture.end,
      kind: "text-range",
      start: capture.start
    },
    anchorResolution: capture.anchorResolution,
    card,
    contextHash: capture.contextHash,
    quote: capture.quote
  }
}

export function toAssistantSelectionRef(draft: ContentSelectionDraft): AssistantSelectionRef {
  if (draft.card.sourceType !== "message") {
    throw new Error("[ContentSelection] Prompt text references require a message source.")
  }
  return {
    selectedText: draft.quote,
    sourceMessageId: draft.card.sourceId,
    sourceThreadId: draft.card.threadId,
    type: "assistant-message-selection"
  }
}
