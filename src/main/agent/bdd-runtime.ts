interface CreateBddAgentRuntimeOptions {
  threadId: string
  workspacePath: string
}

type BddStreamChunk = [mode: "messages" | "values", data: unknown]

interface BddAgentRuntime {
  stream(input: unknown, config: { signal?: AbortSignal }): AsyncGenerator<BddStreamChunk>
}

function createSerializedMessage(params: {
  content: string
  id: string
  role: "ai" | "human"
  toolCalls?: Array<{ args: Record<string, unknown>; id: string; name: string }>
}): {
  id: string[]
  kwargs: {
    content: string
    id: string
    tool_calls?: Array<{ args: Record<string, unknown>; id: string; name: string }>
  }
  type: "ai" | "human"
} {
  return {
    id: [params.role === "human" ? "HumanMessage" : "AIMessage"],
    kwargs: {
      content: params.content,
      id: params.id,
      ...(params.toolCalls ? { tool_calls: params.toolCalls } : {})
    },
    type: params.role
  }
}

function readPromptText(input: unknown): string {
  const messages = (input as { messages?: Array<{ content?: unknown }> }).messages ?? []
  const content = messages[0]?.content

  if (typeof content === "string") {
    return content
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => (part && typeof part === "object" ? (part as { text?: unknown }).text : null))
      .filter((part): part is string => typeof part === "string")
      .join("\n")
  }

  return ""
}

async function waitForAbort(signal: AbortSignal | undefined): Promise<void> {
  if (!signal || signal.aborted) {
    return
  }

  await new Promise<void>((resolve) => {
    signal.addEventListener("abort", () => resolve(), { once: true })
  })
}

function createCompletionState(options: CreateBddAgentRuntimeOptions, content: string) {
  return {
    messages: [
      createSerializedMessage({
        content,
        id: `${options.threadId}:bdd:assistant`,
        role: "ai"
      })
    ],
    todos: [
      {
        content,
        id: `${options.threadId}:bdd:todo`,
        status: "completed"
      }
    ],
    workspacePath: options.workspacePath
  }
}

function createInterruptState(options: CreateBddAgentRuntimeOptions) {
  const toolCallId = `${options.threadId}:bdd:write-file`
  const targetPath = `${options.workspacePath}/approval.txt`
  const toolArgs = {
    content: "approved by human",
    path: targetPath
  }

  return {
    messages: [
      createSerializedMessage({
        content: "",
        id: `${options.threadId}:bdd:approval-request`,
        role: "ai",
        toolCalls: [
          {
            args: toolArgs,
            id: toolCallId,
            name: "write_file"
          }
        ]
      })
    ],
    __interrupt__: [
      {
        value: {
          actionRequests: [
            {
              args: toolArgs,
              id: `${options.threadId}:bdd:approval-action`,
              name: "write_file",
              review: {
                changes: [
                  {
                    changeType: "create",
                    path: targetPath
                  }
                ],
                content: toolArgs.content,
                kind: "file_mutation",
                newText: null,
                oldText: null,
                path: targetPath,
                toolName: "write_file"
              },
              toolCallId
            }
          ],
          reviewConfigs: [
            {
              actionName: "write_file",
              allowedDecisions: ["approve", "reject"]
            }
          ]
        }
      }
    ],
    workspacePath: options.workspacePath
  }
}

export function createBddAgentRuntime(options: CreateBddAgentRuntimeOptions): BddAgentRuntime {
  return {
    async *stream(input, config): AsyncGenerator<BddStreamChunk> {
      const promptText = readPromptText(input)

      if (promptText.includes("bdd:long")) {
        yield [
          "values",
          {
            messages: [
              createSerializedMessage({
                content: "scripted agent long task started",
                id: `${options.threadId}:bdd:long`,
                role: "ai"
              })
            ],
            todos: [
              {
                content: "scripted agent long task started",
                id: `${options.threadId}:bdd:long-task`,
                status: "in_progress"
              }
            ],
            workspacePath: options.workspacePath
          }
        ]

        await waitForAbort(config.signal)
        return
      }

      if (promptText.includes("bdd:interrupt")) {
        yield ["values", createInterruptState(options)]
        return
      }

      if (!promptText) {
        const content = "scripted agent approval resolved"
        yield [
          "messages",
          [
            createSerializedMessage({
              content,
              id: `${options.threadId}:bdd:resume-message`,
              role: "ai"
            }),
            { langgraph_node: "agent" }
          ]
        ]
        yield ["values", createCompletionState(options, content)]
        return
      }

      const content = "scripted agent completed"
      yield [
        "messages",
        [
          createSerializedMessage({
            content,
            id: `${options.threadId}:bdd:success-message`,
            role: "ai"
          }),
          { langgraph_node: "agent" }
        ]
      ]
      yield ["values", createCompletionState(options, content)]
    }
  }
}
