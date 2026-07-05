export interface SelectJingleValuesAssistantForCurrentStreamInput<TMessage> {
  activeAssistantMessageId: string | null
  activeTurnId: string
  currentTurnMessages: readonly TMessage[]
  getId(message: TMessage): string
  getRole(message: TMessage): string
  getToolCallIds(message: TMessage): readonly string[]
  valuesMessages: readonly TMessage[]
}

export function selectJingleValuesAssistantForCurrentStream<TMessage>(
  input: SelectJingleValuesAssistantForCurrentStreamInput<TMessage>
): TMessage | null {
  const {
    activeAssistantMessageId,
    activeTurnId,
    currentTurnMessages,
    getId,
    getRole,
    getToolCallIds,
    valuesMessages
  } = input

  if (activeAssistantMessageId) {
    const currentAssistant = currentTurnMessages.find(
      (message) => getId(message) === activeAssistantMessageId && getRole(message) === "assistant"
    )
    if (currentAssistant && getToolCallIds(currentAssistant).length > 0) {
      return null
    }
  }

  const existingToolCallIds = new Set<string>()
  for (const message of currentTurnMessages) {
    if (getRole(message) !== "assistant") {
      continue
    }

    for (const toolCallId of getToolCallIds(message)) {
      existingToolCallIds.add(toolCallId)
    }
  }

  const turnStartIndex = valuesMessages.findIndex(
    (message) => getRole(message) === "user" && getId(message) === activeTurnId
  )
  if (turnStartIndex < 0) {
    return null
  }

  const nextTurnStartIndex = valuesMessages.findIndex(
    (message, index) => index > turnStartIndex && getRole(message) === "user"
  )
  const turnEndIndex = nextTurnStartIndex < 0 ? valuesMessages.length : nextTurnStartIndex
  return (
    valuesMessages
      .slice(turnStartIndex, turnEndIndex)
      .filter((message) => {
        const toolCallIds = getToolCallIds(message)
        return (
          getRole(message) === "assistant" &&
          toolCallIds.length > 0 &&
          !toolCallIds.some((toolCallId) => existingToolCallIds.has(toolCallId))
        )
      })
      .at(-1) ?? null
  )
}
