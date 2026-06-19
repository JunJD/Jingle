const TODO_LIST_TOOL_NAMES = new Set(["write_todos", "update_todos"])

export function isTodoListToolName(name: string): boolean {
  return TODO_LIST_TOOL_NAMES.has(name)
}
