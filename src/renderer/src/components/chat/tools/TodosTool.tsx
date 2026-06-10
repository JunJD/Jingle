import { ListTodo } from "lucide-react"
import { defineToolComponent } from "./registry-core"
import { ToolDetailStack, ToolTodoList } from "./shared-components"
import { asTodos } from "./shared"

defineToolComponent({
  name: "write_todos",
  icon: ListTodo,
  renderDisplay({ copy, args }) {
    const todos = asTodos(args.todos)
    const completedCount = todos.filter((todo) => todo.status === "completed").length
    const progress =
      todos.length > 0 ? copy.toolCall.todoProgress(completedCount, todos.length) : null

    return {
      detail: progress,
      title: copy.toolCall.labels.write_todos
    }
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
