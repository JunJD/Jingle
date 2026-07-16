interface CreateBddAgentRuntimeOptions {
  threadId: string
  workspacePath: string
}

type BddStreamChunk = [mode: "messages" | "values", data: unknown]

interface BddAgentRuntime {
  stream(input: unknown, config: { signal?: AbortSignal }): AsyncGenerator<BddStreamChunk>
}

function createSerializedMessage(params: { content: string; id: string; role: "ai" | "human" }): {
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

async function* streamSerializedAssistantMessage(params: {
  chunks: readonly string[]
  id: string
  signal: AbortSignal | undefined
}): AsyncGenerator<BddStreamChunk> {
  for (const chunk of params.chunks) {
    if (params.signal?.aborted) {
      return
    }

    yield [
      "messages",
      [
        createSerializedMessage({
          content: chunk,
          id: params.id,
          role: "ai"
        }),
        { langgraph_node: "agent" }
      ]
    ]

    if ((await waitForDelay(350, params.signal)) === "aborted") {
      return
    }
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
  const decisions = (
    input as {
      resume?: { decisions?: Array<{ correction?: string; type?: string }> }
    }
  ).resume?.decisions

  if (!Array.isArray(decisions)) {
    return ""
  }

  return decisions
    .flatMap((decision) => (decision.type === "corrected" ? [decision.correction] : []))
    .join("\n")
}

function readInputContextInclusions(input: unknown): unknown[] | undefined {
  const contextInclusions = (input as { update?: { contextInclusions?: unknown } }).update
    ?.contextInclusions
  return Array.isArray(contextInclusions) ? contextInclusions : undefined
}

async function waitForAbort(signal: AbortSignal | undefined): Promise<void> {
  if (!signal || signal.aborted) {
    return
  }

  await new Promise<void>((resolve) => {
    signal.addEventListener("abort", () => resolve(), { once: true })
  })
}

async function waitForDelay(
  ms: number,
  signal: AbortSignal | undefined
): Promise<"aborted" | "ready"> {
  if (signal?.aborted) {
    return "aborted"
  }

  return new Promise<"aborted" | "ready">((resolve) => {
    const timeout = setTimeout(() => resolve("ready"), ms)
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout)
        resolve("aborted")
      },
      { once: true }
    )
  })
}

function createCompletionState(
  options: CreateBddAgentRuntimeOptions,
  content: string,
  todoId: string,
  input?: unknown
) {
  const contextInclusions = input ? readInputContextInclusions(input) : undefined

  return {
    ...(contextInclusions ? { contextInclusions } : {}),
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
              allowedDecisions: ["approve", "user_declined", "corrected"]
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

      if (promptText.includes("bdd:delay-first-chunk")) {
        if (config.signal?.aborted) {
          return
        }

        if ((await waitForDelay(2_000, config.signal)) === "aborted") {
          return
        }

        const content = "scripted agent delayed first chunk completed"
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
        yield ["values", createCompletionState(options, content, todoId, input)]
        return
      }

      if (promptText.includes("bdd:stream")) {
        const chunks = ["scripted ", "agent ", "streamed ", "chunked ", "completion"] as const
        const content = chunks.join("")

        yield* streamSerializedAssistantMessage({
          chunks,
          id: assistantMessageId,
          signal: config.signal
        })
        yield ["values", createCompletionState(options, content, todoId, input)]
        return
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
        yield ["values", createCompletionState(options, content, todoId, input)]
        return
      }

      const content = "scripted agent completed"
      if ((await waitForDelay(350, config.signal)) === "aborted") {
        return
      }

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
      yield ["values", createCompletionState(options, content, todoId, input)]
    }
  }
}
