import type { IpcErrorPayload } from "./ipc-error"
import type { ComposerMessageInput, ComposerMessageRef } from "./message-content"

export type AgentCommandOutcome =
  | {
      disposition: "run" | "steer"
      type: "accepted"
    }
  | {
      error: IpcErrorPayload
      type: "rejected"
    }

export type AgentCommandLifecycleEvent =
  | {
      commandId: string
      threadId: string
      type: "admitted"
    }
  | {
      commandId: string
      threadId: string
      type: "projection_applied"
    }
  | {
      commandId: string
      error: IpcErrorPayload
      threadId: string
      type: "projection_failed"
    }

export function getAgentCommandLifecycleChannel(commandId: string): string {
  return `agent:command-lifecycle:${commandId}`
}

function areComposerCommandRefsEqual(left: ComposerMessageRef, right: ComposerMessageRef): boolean {
  if (left.type !== right.type) {
    return false
  }

  switch (left.type) {
    case "file":
      return right.type === "file" && left.name === right.name && left.path === right.path
    case "image":
      return right.type === "image" && left.name === right.name && left.url === right.url
    case "extension-source":
      return (
        right.type === "extension-source" &&
        left.extensionName === right.extensionName &&
        left.name === right.name &&
        left.sourceId === right.sourceId
      )
    case "assistant-message-selection":
      return (
        right.type === "assistant-message-selection" &&
        left.selectedText === right.selectedText &&
        left.sourceMessageId === right.sourceMessageId &&
        left.sourceThreadId === right.sourceThreadId
      )
  }
}

export function areComposerCommandInputsEqual(
  left: ComposerMessageInput,
  right: ComposerMessageInput
): boolean {
  return (
    left.text === right.text &&
    left.refs.length === right.refs.length &&
    left.refs.every((ref, index) => {
      const rightRef = right.refs[index]
      return rightRef !== undefined && areComposerCommandRefsEqual(ref, rightRef)
    })
  )
}
