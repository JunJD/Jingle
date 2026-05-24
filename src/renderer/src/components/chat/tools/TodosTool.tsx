import { ListTodo } from "lucide-react"
import { defineToolComponent } from "./registry-core"
import { ToolDetailStack, ToolTodoList } from "./shared-components"
import { asTodos, joinSummaryParts } from "./shared"

defineToolComponent({
  name: "write_todos",
  icon: ListTodo,
  renderSummary({ copy }) {
    return joinSummaryParts(copy.toolCall.labels.write_todos)
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
