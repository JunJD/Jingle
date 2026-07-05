
import { createAgentState } from "./annotation.js"
import { initializeMiddlewareStates } from "./nodes/legacy/legacy-node-utils.js"
import { Command } from "@langchain/langgraph"
import type { AgentMiddleware } from "langchain"

export function createRuntimeGraphStateSchemas(input: {
  readonly hasStructuredResponse: boolean
  readonly middleware: readonly AgentMiddleware[]
  readonly stateSchema: unknown
}) {
  return createAgentState(input.hasStructuredResponse, input.stateSchema, input.middleware)
}

export async function initializeRuntimeMiddlewareState(input: {
  readonly graph: {
    getState(config: unknown): Promise<{ values?: Record<string, unknown> } | undefined>
  }
  readonly middleware: readonly AgentMiddleware[]
  readonly state: any
  readonly config: unknown
}) {
  if (input.middleware.length === 0 || input.state instanceof Command || !input.state)
    return input.state

  const defaultStates = await initializeMiddlewareStates(input.middleware, input.state)
  const updatedState = {
    ...(await input.graph.getState(input.config))?.values,
    ...input.state
  }
  if (!updatedState) return updatedState

  for (const [key, value] of Object.entries(defaultStates))
    if (!(key in updatedState)) updatedState[key] = value
  return updatedState
}
