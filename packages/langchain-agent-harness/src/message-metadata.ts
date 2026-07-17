import type { MessageContent } from "@langchain/core/messages"

export const JINGLE_COMPOSER_TEXT_METADATA_KEY = "jingle_composer_text"
export const JINGLE_USER_MESSAGE_ADMISSION_METADATA_KEY = "jingle_user_message_admission"

export interface JingleUserMessageAdmissionIdentity {
  eventId: string
  sequence: number
}

export function getJingleStandardContentResponseMetadata(
  content: MessageContent
): { output_version: "v1" } | undefined {
  if (
    !Array.isArray(content) ||
    !content.some((block) => block !== null && typeof block === "object" && block.type === "file")
  ) {
    return undefined
  }

  return { output_version: "v1" }
}
