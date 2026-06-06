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
}): {
  id: string[]
  kwargs: {
    content: string
    id: string
  }
  type: "ai" | "human"
} {
  return {
    id: [params.role === "human" ? "HumanMessage" : "AIMessage"],
    kwargs: {
      content: params.content,
      id: params.id
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

function readResumeFeedback(input: unknown): string {
  const decisions = (input as { resume?: { decisions?: Array<{ feedback?: unknown }> } }).resume
    ?.decisions

  if (!Array.isArray(decisions)) {
    return ""
  }

  return decisions
    .map((decision) => (typeof decision.feedback === "string" ? decision.feedback : ""))
    .filter(Boolean)
    .join("\n")
}

async function waitForAbort(signal: AbortSignal | undefined): Promise<void> {
  if (!signal || signal.aborted) {
    return
  }

  await new Promise<void>((resolve) => {
    signal.addEventListener("abort", () => resolve(), { once: true })
  })
}

function createCompletionState(
  options: CreateBddAgentRuntimeOptions,
  content: string,
  todoId: string
) {
  return {
    todos: [
      {
        content,
        id: todoId,
        status: "completed"
      }
    ],
    workspacePath: options.workspacePath
  }
}

function createInterruptState(options: CreateBddAgentRuntimeOptions, invocationId: string) {
  const toolCallId = `${options.threadId}:${invocationId}:bdd:write-file`
  const targetPath = `${options.workspacePath}/approval.txt`
  const toolArgs = {
    content: "approved by human",
    path: targetPath
  }

  return {
    __interrupt__: [
      {
        value: {
          actionRequests: [
            {
              args: toolArgs,
              id: `${options.threadId}:${invocationId}:bdd:approval-action`,
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
      const resumeFeedback = readResumeFeedback(input)
      const invocationId = crypto.randomUUID()
      const assistantMessageId = `${options.threadId}:${invocationId}:bdd:assistant`
      const todoId = `${options.threadId}:${invocationId}:bdd:todo`

      if (resumeFeedback.includes("bdd:fail-before-first-chunk")) {
        throw new Error("scripted agent failed before first chunk")
      }

      if (promptText.includes("bdd:long")) {
        const content = "scripted agent long task started"
        yield [
          "messages",
          [
            createSerializedMessage({
              content,
              id: `${options.threadId}:${invocationId}:bdd:long`,
              role: "ai"
            }),
            { langgraph_node: "agent" }
          ]
        ]
        yield [
          "values",
          {
            todos: [
              {
                content,
                id: `${options.threadId}:${invocationId}:bdd:long-task`,
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
        yield ["values", createInterruptState(options, invocationId)]
        return
      }

      if (!promptText) {
        const content = "scripted agent approval resolved"
        yield [
          "messages",
          [
            createSerializedMessage({
              content,
              id: assistantMessageId,
              role: "ai"
            }),
            { langgraph_node: "agent" }
          ]
        ]
        yield ["values", createCompletionState(options, content, todoId)]
        return
      }

      const content = "scripted agent completed"
      yield [
        "messages",
        [
          createSerializedMessage({
            content,
            id: assistantMessageId,
            role: "ai"
          }),
          { langgraph_node: "agent" }
        ]
      ]
      yield ["values", createCompletionState(options, content, todoId)]
    }
  }
}
