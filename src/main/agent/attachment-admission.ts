import { isDeepStrictEqual } from "node:util"
import {
  normalizeComposerMessageRefs,
  toAgentMessageContentWithRefs,
  toMessageContent,
  type AgentInvokeMessage
} from "@shared/message-content"

export function getCanonicalAttachmentMessageError(message: AgentInvokeMessage): string | null {
  const refs = normalizeComposerMessageRefs(message.refs)
  const hasAttachmentContent =
    Array.isArray(message.content) &&
    message.content.some((block) => block.type === "file" || block.type === "image_url")
  const hasAttachmentRefs = refs.some(
    (ref) => ref.type === "file-attachment" || ref.type === "image"
  )
  if (!hasAttachmentContent && !hasAttachmentRefs) {
    return null
  }
  if (typeof message.composerText !== "string") {
    return "Composer text is required for attachments."
  }

  const canonicalContent = toAgentMessageContentWithRefs(
    toMessageContent({ refs, text: message.composerText }),
    refs
  )
  return isDeepStrictEqual(message.content, canonicalContent)
    ? null
    : "Attachment content does not match canonical composer references."
}
