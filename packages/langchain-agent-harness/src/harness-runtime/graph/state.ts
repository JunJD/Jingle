interface RuntimeStateMiddleware {
  readonly name: string
}

interface RuntimeStateNode {
  getState(): Record<string, unknown> | undefined
}

/**
 * Shares private middleware state across RuntimeGraph's internal middleware node segment.
 *
 * RuntimeGraph is still migrating away from middleware-owned topology, so this
 * remains an internal helper for the current engine rather than target RuntimeState.
 */
export class StateManager {
  #nodes = new Map<string, RuntimeStateNode[]>()

  addNode(middleware: RuntimeStateMiddleware, node: RuntimeStateNode): void {
    this.#nodes.set(middleware.name, [...(this.#nodes.get(middleware.name) ?? []), node])
  }

  getState(name: string): Record<string, unknown> {
    const state: Record<string, unknown> = {}

    for (const node of this.#nodes.get(name) ?? []) {
      const nodeState = node.getState()
      if (nodeState) Object.assign(state, nodeState)
    }

    // jumpTo is an internal routing sentinel and must not leak into middleware hooks.
    delete state.jumpTo
    return state
  }
}
