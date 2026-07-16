import { ListTodo } from "lucide-react"
import { defineToolComponent } from "./registry-core"
import { ToolContractNotice, ToolDetailStack, ToolTodoList } from "./shared-components"
import { projectToolTodos } from "./shared"

defineToolComponent({
  name: "write_todos",
  icon: ListTodo,
  project({ args, status }) {
    const projection = projectToolTodos(args.todos, status === "arguments_streaming")
    const todos = projection.kind === "ready" ? projection.todos : []
    return {
      completedCount: todos.filter((todo) => todo.status === "completed").length,
      projection
    }
  },
  hasDetail({ viewModel }) {
    return (
      viewModel.projection.kind === "invalid" ||
      (viewModel.projection.kind === "ready" && viewModel.projection.todos.length > 0)
    )
  },
  renderDisplay({ copy, viewModel }) {
    const todos = viewModel.projection.kind === "ready" ? viewModel.projection.todos : []
    const progress =
      todos.length > 0 ? copy.toolCall.todoProgress(viewModel.completedCount, todos.length) : null

    return {
      detail: progress,
      title: copy.toolCall.labels.write_todos
    }
  },
  renderDetail({ copy, viewModel }) {
    if (viewModel.projection.kind === "invalid") {
      return <ToolContractNotice copy={copy} field={viewModel.projection.field} />
    }

    if (viewModel.projection.kind === "pending") {
      return null
    }

    return (
      <ToolDetailStack>
        <ToolTodoList todos={viewModel.projection.todos} />
      </ToolDetailStack>
    )
  }
})
