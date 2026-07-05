import { AIMessage, ToolMessage } from "@langchain/core/messages"
import { tool } from "@langchain/core/tools"
import { Command } from "@langchain/langgraph"
import {
  createMiddleware,
  type AfterModelHook,
  type BuiltInState,
  type AgentMiddleware
} from "langchain"
import { z } from "zod/v3"

const todoStatusSchema = z
  .enum(["pending", "in_progress", "completed"])
  .describe("Status of the todo")

const todoSchema = z.object({
  content: z.string().describe("Content of the todo item"),
  status: todoStatusSchema
})

const todoStateSchema = z.object({
  todos: z.array(todoSchema).default([])
})

export type JingleTodoListItem = z.infer<typeof todoSchema>

export interface JingleTodoListMiddlewareOptions {
  systemPrompt: string
  toolDescription: string
}

type JingleTodoListState = z.infer<typeof todoStateSchema>

type JingleTodoListAfterModel = (
  state: Pick<BuiltInState, "messages"> & Partial<JingleTodoListState>,
  runtime: unknown
) => { messages: ToolMessage[] } | undefined

export type JingleTodoListMiddleware = AgentMiddleware<
  typeof todoStateSchema,
  undefined,
  unknown,
  readonly [ReturnType<typeof createWriteTodosTool>]
> & {
  afterModel: JingleTodoListAfterModel
}

function createWriteTodosTool(options: JingleTodoListMiddlewareOptions) {
  return tool(
    ({ todos }, config) => {
      const toolCallId = config.toolCall?.id
      if (!toolCallId) {
        throw new Error("[JingleTodoListMiddleware] Missing tool_call.id for write_todos.")
      }

      return new Command({
        update: {
          todos,
          messages: [
            new ToolMessage({
              content: `Updated todo list to ${JSON.stringify(todos)}`,
              tool_call_id: toolCallId
            })
          ]
        }
      })
    },
    {
      name: "write_todos",
      description: options.toolDescription,
      schema: z.object({
        todos: z.array(todoSchema).describe("List of todo items to update")
      })
    }
  )
}

export function createJingleTodoListMiddleware(
  options: JingleTodoListMiddlewareOptions
): JingleTodoListMiddleware {
  const writeTodos = createWriteTodosTool(options)
  const afterModel: JingleTodoListAfterModel = (state) => {
    const messages = state.messages
    if (!messages || messages.length === 0) {
      return undefined
    }

    const lastAiMessage = [...messages].reverse().find((message) => AIMessage.isInstance(message))
    if (!lastAiMessage?.tool_calls?.length) {
      return undefined
    }

    const writeTodoCalls = lastAiMessage.tool_calls.filter(
      (toolCall) => toolCall.name === writeTodos.name
    )
    if (writeTodoCalls.length <= 1) {
      return undefined
    }

    return {
      messages: writeTodoCalls.map(
        (toolCall) => {
          if (!toolCall.id) {
            throw new Error("[JingleTodoListMiddleware] Missing tool_call.id for write_todos.")
          }

          return new ToolMessage({
            content:
              "Error: The `write_todos` tool should never be called multiple times " +
              "in parallel. Please call it only once per model invocation to update " +
              "the todo list.",
            status: "error",
            tool_call_id: toolCall.id
          })
        }
      )
    }
  }

  const middleware = createMiddleware({
    name: "jingleTodoListMiddleware",
    stateSchema: todoStateSchema,
    tools: [writeTodos],
    wrapModelCall: (request, handler) =>
      handler({
        ...request,
        systemMessage: request.systemMessage.concat(`\n\n${options.systemPrompt}`)
      }),
    afterModel: afterModel as AfterModelHook<typeof todoStateSchema, unknown>
  })

  return {
    ...middleware,
    afterModel
  }
}
