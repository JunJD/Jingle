
import { MiddlewareError } from "./errors.js"
import type { StateManager } from "./state.js"
import { ToolMessage } from "@langchain/core/messages"
import { StateSchema, isCommand } from "@langchain/langgraph"
import { interopParse, isInteropZodSchema } from "@langchain/core/utils/types"
import type { AgentMiddleware } from "langchain"

export interface InternalMiddlewareExecution {
  readonly modelCallWrappers: readonly any[]
  readonly toolCallWrapper: any
  readonly tools: readonly unknown[]
  readonly usesToolCallWrapper: boolean
}

function parseMiddlewareState(stateSchema: any, state: any) {
  if (StateSchema.isInstance(stateSchema)) {
    const result: Record<string, unknown> = {}
    for (const key of Object.keys(stateSchema.fields)) if (key in state) result[key] = state[key]
    return result
  }

  if (isInteropZodSchema(stateSchema)) return interopParse(stateSchema, state)

  throw new Error(`Invalid state schema type: ${typeof stateSchema}`)
}

function chainToolCallHandlers(handlers: any[]) {
  if (handlers.length === 0) return
  if (handlers.length === 1) return handlers[0]

  function composeTwo(outer: any, inner: any) {
    return async (request: any, handler: any) => {
      const innerHandler = async (passedRequest: any) => inner(passedRequest, handler)
      return outer(request, innerHandler)
    }
  }

  let result = handlers[handlers.length - 1]
  for (let i = handlers.length - 2; i >= 0; i--) result = composeTwo(handlers[i], result)
  return result
}

function createToolCallWrapper(middleware: readonly AgentMiddleware[]) {
  const middlewareWithWrapToolCall = middleware.filter((entry) => entry.wrapToolCall)
  if (middlewareWithWrapToolCall.length === 0) return

  return chainToolCallHandlers(
    middlewareWithWrapToolCall.map((entry) => {
      const originalHandler = entry.wrapToolCall

      return async (request: any, handler: any) => {
        const originalState = request.state
        const wrappedInnerHandler = async (passedRequest: any) => {
          const mergedState = {
            ...originalState,
            ...passedRequest.state
          }
          return handler({
            ...passedRequest,
            state: mergedState
          })
        }

        try {
          const result = await originalHandler?.(
            {
              ...request,
              state: {
                messages: originalState.messages,
                ...(entry.stateSchema
                  ? parseMiddlewareState(entry.stateSchema, { ...originalState })
                  : {})
              }
            },
            wrappedInnerHandler
          )

          if (!ToolMessage.isInstance(result) && !isCommand(result))
            throw new Error(
              `Invalid response from "wrapToolCall" in middleware "${entry.name}": expected ToolMessage or Command, got ${typeof result}`
            )
          return result
        } catch (error) {
          throw MiddlewareError.wrap(error, entry.name)
        }
      }
    })
  )
}

export function createInternalMiddlewareExecution(input: {
  readonly middleware: readonly AgentMiddleware[]
  readonly stateManager: StateManager
}): InternalMiddlewareExecution {
  const modelCallWrappers = input.middleware
    .filter((middleware) => middleware.wrapModelCall)
    .map((middleware) => [
      middleware,
      () => input.stateManager.getState(middleware.name)
    ])

  return {
    modelCallWrappers,
    toolCallWrapper: createToolCallWrapper(input.middleware),
    tools: input.middleware
      .filter((middleware) => middleware.tools)
      .flatMap((middleware) => middleware.tools),
    usesToolCallWrapper: input.middleware.some((middleware) => middleware.wrapToolCall)
  }
}
