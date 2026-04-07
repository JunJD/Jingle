import { createMiddleware, tool } from "langchain"
import { searchWeb } from "../services/web-tools"

interface WebSearchInput {
  query?: unknown
}

function requireStringArg(value: unknown, argName: string, toolName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${toolName} requires a non-empty "${argName}" string.`)
  }

  return value.trim()
}

const webSearchTool = tool(
  async (input) => {
    const query = requireStringArg((input as WebSearchInput).query, "query", "web_search")
    return searchWeb(query)
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

const webToolsMiddleware = createMiddleware({
  name: "openworkWebTools",
  tools: [webSearchTool]
})

export function createWebToolsMiddleware() {
  return webToolsMiddleware
}
