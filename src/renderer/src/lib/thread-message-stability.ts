import type { Message } from "@/types"
import { stabilizeReferences } from "./stabilize-references"

export function stabilizeThreadMessages(previous: Message[], next: Message[]): Message[] {
  const previousById = new Map(previous.map((message) => [message.id, message]))
  let isEqual = previous.length === next.length

  const messages = next.map((nextMessage, index) => {
    const previousMessage = previousById.get(nextMessage.id)
    const stableMessage = previousMessage
      ? stabilizeReferences(previousMessage, nextMessage)
      : nextMessage

    if (!Object.is(stableMessage, previous[index])) {
      isEqual = false
    }

    return stableMessage
  })

  return isEqual ? previous : messages
}
