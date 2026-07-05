import { createMiddleware, tool } from "langchain"

export interface JingleWebToolHandlers {
  searchWeb: (query: string) => Promise<unknown>
}

interface WebSearchInput {
  query?: unknown
}

function requireJingleStringArg(value: unknown, argName: string, toolName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${toolName} requires a non-empty "${argName}" string.`)
  }

  return value.trim()
}

export function createJingleWebToolsMiddleware(handlers: JingleWebToolHandlers) {
  const webSearchTool = tool(
    async (input) => {
      const query = requireJingleStringArg((input as WebSearchInput).query, "query", "web_search")
      return handlers.searchWeb(query)
    },
    {
      description:
        "Search the public web for current or external information. Use this when the answer depends on recent facts, news, public documentation, products, or sources outside the workspace. Prefer specific queries.",
      name: "web_search",
      schema: {
        additionalProperties: false,
        properties: {
          query: {
            description: "The search query to run on the public web.",
            type: "string"
          }
        },
        required: ["query"],
        type: "object"
      }
    }
  )

  return createMiddleware({
    name: "jingleWebTools",
    tools: [webSearchTool]
  })
}
