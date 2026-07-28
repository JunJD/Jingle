import { createMiddleware, tool, type ToolRuntime } from "langchain"
import { COMPUTER_USE_NATIVE_RESPONSE_LIMITS } from "@jingle/computer-use-core"
import {
  getRunIdFromToolRuntime,
  getThreadIdFromToolRuntime,
  getToolCallIdFromToolRuntime
} from "./tool-runtime"

export interface JingleComputerUseToolContext {
  runId: string
  signal: AbortSignal
  threadId: string
  toolCallId: string
}

type JingleComputerUseToolHandler = (
  input: unknown,
  context: JingleComputerUseToolContext
) => Promise<unknown>

const tokenStringSchema = {
  maxLength: COMPUTER_USE_NATIVE_RESPONSE_LIMITS.token,
  minLength: 1,
  type: "string"
} as const

const textStringSchema = {
  maxLength: COMPUTER_USE_NATIVE_RESPONSE_LIMITS.text,
  minLength: 1,
  type: "string"
} as const

export interface JingleComputerUseToolHandlers {
  action: JingleComputerUseToolHandler
  allowedApplicationIds: readonly string[]
  expand: JingleComputerUseToolHandler
  inspect: JingleComputerUseToolHandler
  observe: JingleComputerUseToolHandler
  search: JingleComputerUseToolHandler
}

function requireComputerUseToolContext(runtime: ToolRuntime): JingleComputerUseToolContext {
  const runId = getRunIdFromToolRuntime(runtime)
  const threadId = getThreadIdFromToolRuntime(runtime)
  const toolCallId = getToolCallIdFromToolRuntime(runtime)
  const { signal } = runtime
  if (!runId || !threadId || !toolCallId || !signal) {
    throw new Error("Computer use requires an active run caller lease.")
  }
  signal.throwIfAborted()
  return Object.freeze({ runId, signal, threadId, toolCallId })
}

function withCaller(handler: JingleComputerUseToolHandler) {
  return (input: unknown, runtime: ToolRuntime) => {
    return handler(input, requireComputerUseToolContext(runtime))
  }
}

const semanticActionSchema = {
  oneOf: [
    {
      additionalProperties: false,
      properties: {
        kind: { const: "press" },
        ref: tokenStringSchema
      },
      required: ["kind", "ref"],
      type: "object"
    },
    ...["set_value", "type_text"].map((kind) => ({
      additionalProperties: false,
      properties: {
        kind: { const: kind },
        ref: tokenStringSchema,
        value: { maxLength: COMPUTER_USE_NATIVE_RESPONSE_LIMITS.text, type: "string" }
      },
      required: ["kind", "ref", "value"],
      type: "object"
    })),
    {
      additionalProperties: false,
      properties: {
        keys: {
          items: tokenStringSchema,
          maxItems: COMPUTER_USE_NATIVE_RESPONSE_LIMITS.keys,
          minItems: 1,
          type: "array",
          uniqueItems: true
        },
        kind: { const: "keypress" },
        ref: tokenStringSchema
      },
      required: ["kind", "ref", "keys"],
      type: "object"
    },
    {
      additionalProperties: false,
      properties: {
        kind: { const: "scroll" },
        ref: tokenStringSchema,
        scrollAmount: { type: "number" }
      },
      required: ["kind", "ref", "scrollAmount"],
      type: "object"
    }
  ]
} as const

const activateActionSchema = {
  additionalProperties: false,
  properties: {
    kind: { const: "activate" },
    ref: tokenStringSchema
  },
  required: ["kind", "ref"],
  type: "object"
} as const

const semanticActionTransactionSchema = {
  oneOf: [
    {
      items: activateActionSchema,
      maxItems: 1,
      minItems: 1,
      type: "array"
    },
    {
      items: semanticActionSchema,
      maxItems: COMPUTER_USE_NATIVE_RESPONSE_LIMITS.actions,
      minItems: 1,
      type: "array"
    }
  ]
} as const

export function createJingleComputerUseToolsMiddleware(handlers: JingleComputerUseToolHandlers) {
  const observe = tool(withCaller(handlers.observe), {
    description:
      "Observe one desktop application window and open a run-scoped Computer Use session. This requires a live Main or separate thread window. Returns a folded semantic view, source completeness, an opaque stateId, and an opaque sessionId. Use the returned stateId for every query or action.",
    name: "computer_use_observe",
    schema: {
      additionalProperties: false,
      properties: {
        applicationId: {
          description: "Select one stable application identifier from this user-managed allowlist.",
          enum: [...handlers.allowedApplicationIds],
          ...tokenStringSchema
        },
        applicationName: {
          description: "Optional visible-name hint; never used for authorization.",
          ...textStringSchema
        },
        windowId: {
          description: "Optional native window hint; never used for authorization.",
          ...tokenStringSchema
        }
      },
      required: ["applicationId"],
      type: "object"
    }
  })

  const action = tool(withCaller(handlers.action), {
    description:
      "Apply ordered semantic actions to refs owned by one Computer Use state. Activate is a single-action foreground transaction and its ref must be the current window root. Returns typed outcome/evidence, an explicit retry disposition, and a successor diff or folded full view. Start another attempt only when retry.allowed is true; unknown or side-effect-possible results must never be retried. Never reuse refs with another stateId.",
    name: "computer_use_action",
    schema: {
      additionalProperties: false,
      properties: {
        actions: {
          ...semanticActionTransactionSchema
        },
        sessionId: tokenStringSchema,
        stateId: tokenStringSchema
      },
      required: ["actions", "sessionId", "stateId"],
      type: "object"
    }
  })

  const search = tool(withCaller(handlers.search), {
    description:
      "Search the immutable Computer Use observation owned by stateId. Check sourceTruncated before treating an absent match as authoritative.",
    name: "computer_use_search",
    schema: {
      additionalProperties: false,
      properties: {
        limit: { maximum: 100, minimum: 1, type: "integer" },
        query: textStringSchema,
        sessionId: tokenStringSchema,
        stateId: tokenStringSchema
      },
      required: ["query", "sessionId", "stateId"],
      type: "object"
    }
  })

  const expand = tool(withCaller(handlers.expand), {
    description:
      "Read another bounded page from the immutable Computer Use observation owned by stateId. sourceTruncated reports whether the native source itself was incomplete.",
    name: "computer_use_expand",
    schema: {
      additionalProperties: false,
      properties: {
        limit: { maximum: 100, minimum: 1, type: "integer" },
        offset: { minimum: 0, type: "integer" },
        sessionId: tokenStringSchema,
        stateId: tokenStringSchema
      },
      required: ["sessionId", "stateId"],
      type: "object"
    }
  })

  const inspect = tool(withCaller(handlers.inspect), {
    description:
      "Inspect exact semantic refs in the immutable Computer Use observation owned by stateId. sourceTruncated reports native source completeness.",
    name: "computer_use_inspect",
    schema: {
      additionalProperties: false,
      properties: {
        refs: {
          items: tokenStringSchema,
          maxItems: 100,
          minItems: 1,
          type: "array",
          uniqueItems: true
        },
        sessionId: tokenStringSchema,
        stateId: tokenStringSchema
      },
      required: ["refs", "sessionId", "stateId"],
      type: "object"
    }
  })

  return createMiddleware({
    name: "jingleComputerUseToolsMiddleware",
    tools: [observe, action, search, expand, inspect]
  })
}
