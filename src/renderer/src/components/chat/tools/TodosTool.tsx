import { ListTodo } from "lucide-react"
import { defineToolComponent } from "./registry-core"
import { ToolDetailStack, ToolTodoList } from "./shared-components"
import { asTodos, joinSummaryParts } from "./shared"

defineToolComponent({
  name: "write_todos",
  icon: ListTodo,
  renderSummary({ copy, status }) {
    return joinSummaryParts(
      copy.toolCall.labels.write_todos,
      status === "running"
        ? copy.common.running
        : status === "approval"
          ? copy.common.approval
          : status === "error"
            ? copy.common.error
            : copy.common.completed
    )
  },
  renderDetail({ args }) {
    const todos = asTodos(args.todos)

    if (todos.length === 0) {
      return null
    }

    return (
      <ToolDetailStack>
        <ToolTodoList todos={todos} />
      </ToolDetailStack>
    )
  }
})
