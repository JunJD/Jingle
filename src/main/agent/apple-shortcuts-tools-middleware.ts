import { createMiddleware, tool } from "langchain"
import {
  listAppleShortcuts,
  parseRunAppleShortcutRequest,
  runAppleShortcut
} from "../services/apple-shortcuts"

const listAppleShortcutsTool = tool(
  async () => {
    const shortcutNames = await listAppleShortcuts()
    return shortcutNames.length > 0
      ? `Available Apple Shortcuts: ${shortcutNames.join(", ")}`
      : "No Apple Shortcuts are currently available."
  },
  {
    description:
      "List the Apple Shortcuts currently available on this macOS machine. Use this before running a shortcut when you need to discover the exact shortcut name.",
    name: "list_apple_shortcuts",
    schema: {
      additionalProperties: false,
      properties: {},
      type: "object"
    }
  }
)

const runAppleShortcutTool = tool(
  async (input) => {
    const request = parseRunAppleShortcutRequest(input)
    const result = await runAppleShortcut(request)

    return result.output.length > 0
      ? `Ran Apple Shortcut "${result.name}". Output: ${result.output}`
      : `Ran Apple Shortcut "${result.name}".`
  },
  {
    description:
      "Run a named Apple Shortcut on macOS. Use this when the machine already has a Shortcut that wraps an app workflow, script, or automation you want the agent to trigger.",
    name: "run_apple_shortcut",
    schema: {
      additionalProperties: false,
      properties: {
        name: {
          description: "The exact Apple Shortcut name to run.",
          type: "string"
        }
      },
      required: ["name"],
      type: "object"
    }
  }
)

const appleShortcutsToolsMiddleware = createMiddleware({
  name: "openworkAppleShortcutsTools",
  tools: [listAppleShortcutsTool, runAppleShortcutTool]
})

export function createAppleShortcutsToolsMiddleware() {
  return appleShortcutsToolsMiddleware
}
