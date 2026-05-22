import type { BeautifulMentionsItemData } from "lexical-beautiful-mentions"
import type { ComposerMessageRef } from "@shared/message-content"

export type ComposerMentionKind = "extension" | "skill" | "file"

export type ComposerMentionData = Record<string, BeautifulMentionsItemData> & {
  iconName: string
  id: string
  kind: ComposerMentionKind
  sourceId?: string
}

export function getComposerRefFromMention(mention: {
  data?: Record<string, BeautifulMentionsItemData>
  trigger: string
  value: string
}): ComposerMessageRef | null {
  const data = mention.data as Partial<ComposerMentionData> | undefined
  if (mention.trigger !== "@" || data?.kind !== "extension") {
    return null
  }

  const extensionName = typeof data.extensionName === "string" ? data.extensionName.trim() : ""
  const sourceId = typeof data.sourceId === "string" ? data.sourceId.trim() : ""
  if (!extensionName || !sourceId) {
    return null
  }

  return {
    extensionName,
    name: typeof data.id === "string" && data.id.trim() ? data.id.trim() : extensionName,
    sourceId,
    type: "extension-source"
  }
}

export function areComposerRefsEqual(
  left: ComposerMessageRef[],
  right: ComposerMessageRef[]
): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}
