import type { AssistantContentProjectionChangedEvent } from "@shared/assistant-content-part"

type AssistantContentProjectionChangedListener = (
  event: AssistantContentProjectionChangedEvent
) => void

class AssistantContentProjectionEvents {
  private readonly changedListeners = new Set<AssistantContentProjectionChangedListener>()

  onChanged(listener: AssistantContentProjectionChangedListener): () => void {
    this.changedListeners.add(listener)
    return () => this.changedListeners.delete(listener)
  }

  publish(event: AssistantContentProjectionChangedEvent): void {
    for (const listener of this.changedListeners) listener(event)
  }
}

export const assistantContentProjectionEvents = new AssistantContentProjectionEvents()
