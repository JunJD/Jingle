import { CheckCircle2, Circle, Clock, XCircle, ListTodo } from "lucide-react"
import { cn } from "@/lib/utils"
import type { Todo } from "@/types"
import { useI18n } from "@/lib/i18n"

interface ChatTodosProps {
  todos: Todo[]
}

const STATUS_CONFIG = {
  pending: {
    icon: Circle,
    color: "text-muted-foreground"
  },
  in_progress: {
    icon: Clock,
    color: "text-status-info"
  },
  completed: {
    icon: CheckCircle2,
    color: "text-status-nominal"
  },
  cancelled: {
    icon: XCircle,
    color: "text-muted-foreground"
  }
}

export function ChatTodos({ todos }: ChatTodosProps): React.JSX.Element | null {
  const { copy } = useI18n()
  if (todos.length === 0) return null

  // Separate active and completed todos
  const activeTodos = todos.filter((t) => t.status === "in_progress" || t.status === "pending")
  const completedCount = todos.filter((t) => t.status === "completed").length
  const totalCount = todos.length

  // Calculate progress
  const progress = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0

  return (
    <div className="border-t border-border pt-4">
      <div className="flex items-center gap-2">
        <ListTodo className="size-4 text-status-info" />
        <span className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
          {copy.chat.agentTasks}
        </span>
        <span className="ml-auto text-xs text-muted-foreground">
          {completedCount}/{totalCount}
        </span>
        <div className="h-1 w-16 overflow-hidden rounded-full bg-background-secondary">
          <div
            className="h-full bg-status-nominal transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {activeTodos.length > 0 && (
        <div className="space-y-2 pt-3">
          {activeTodos.map((todo) => {
            const config = STATUS_CONFIG[todo.status]
            const Icon = config.icon
            return (
              <div key={todo.id} className="flex items-start gap-2 text-sm text-foreground/90">
                <Icon className={cn("size-3.5 mt-0.5 shrink-0", config.color)} />
                <span>{todo.content}</span>
              </div>
            )
          })}
        </div>
      )}

      {completedCount > 0 && activeTodos.length > 0 && (
        <div className="border-t border-border pt-3 text-xs text-muted-foreground">
          {copy.chat.tasksCompleted(completedCount)}
        </div>
      )}
    </div>
  )
}
