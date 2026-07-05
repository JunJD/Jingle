export interface JingleRuntimeEventApplicationOptions<TState, TEvent> {
  readChangedMessageId?: (event: TEvent) => string | null
  reduceEvent: (state: TState, event: TEvent) => TState
}

export interface JingleRuntimeEventApplicationResult<TState> {
  changed: boolean
  changedMessageId: string | null
  state: TState
}

export function applyJingleRuntimeEvents<TState, TEvent>(
  state: TState,
  events: readonly TEvent[],
  options: JingleRuntimeEventApplicationOptions<TState, TEvent>
): JingleRuntimeEventApplicationResult<TState> {
  let runtimeState = state
  let changedMessageId: string | null = null

  for (const event of events) {
    const previousRuntimeState = runtimeState
    runtimeState = options.reduceEvent(runtimeState, event)

    if (runtimeState === previousRuntimeState) {
      continue
    }

    changedMessageId = options.readChangedMessageId?.(event) ?? null
  }

  return {
    changed: runtimeState !== state,
    changedMessageId,
    state: runtimeState
  }
}
