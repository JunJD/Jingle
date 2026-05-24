import { createGuardrailMiddleware } from "./guardrail-middleware"

const BLOCKED_SUBAGENT_TOOLS = new Set(["execute", "write_file", "edit_file"])

interface CreateSubagentReadOnlyGuardrailMiddlewareOptions {
  threadId: string
  workspacePath: string
}

export function createSubagentReadOnlyGuardrailMiddleware(
  options: CreateSubagentReadOnlyGuardrailMiddlewareOptions
) {
  const { threadId, workspacePath } = options

  return createGuardrailMiddleware({
    threadId,
    workspacePath,
    provider: {
      evaluate({ toolName }) {
        if (!BLOCKED_SUBAGENT_TOOLS.has(toolName)) {
          return { allow: true }
        }

        return {
          allow: false,
          reasons: [
            {
              code: "openwork.subagent.read_only",
              message:
                "Subagents are read-only research workers. Ask the parent agent to execute changes."
            }
          ]
        }
      }
    }
  })
}
