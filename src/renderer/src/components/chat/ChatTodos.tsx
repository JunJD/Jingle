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
    <div className="border-t border-border pt-[var(--ow-space-4)]">
      <div className="flex items-center gap-[var(--ow-gap-sm)]">
        <ListTodo className="size-[var(--ow-icon-action)] text-status-info" />
        <span className="[font-size:var(--ow-font-meta)] font-medium uppercase tracking-[0.12em] text-muted-foreground">
          {copy.chat.agentTasks}
        </span>
        <span className="ml-auto [font-size:var(--ow-font-meta)] text-muted-foreground">
          {completedCount}/{totalCount}
        </span>
        <div className="h-[var(--ow-progress-track-h-sm)] w-[var(--ow-progress-track-w)] overflow-hidden rounded-full bg-background-secondary">
          <div
            className="h-full bg-status-nominal transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {activeTodos.length > 0 && (
        <div className="space-y-[var(--ow-space-2)] pt-[var(--ow-space-3)]">
          {activeTodos.map((todo) => {
            const config = STATUS_CONFIG[todo.status]
            const Icon = config.icon
            return (
              <div
                key={todo.id}
                className="flex items-start gap-[var(--ow-gap-sm)] [font-size:var(--ow-font-body)] text-foreground/90"
              >
                <Icon
                  className={cn(
                    "size-[var(--ow-icon-sm)] mt-[var(--ow-leading-nudge)] shrink-0",
                    config.color
                  )}
                />
                <span>{todo.content}</span>
              </div>
            )
          })}
        </div>
      )}

      {completedCount > 0 && activeTodos.length > 0 && (
        <div className="border-t border-border pt-[var(--ow-space-3)] [font-size:var(--ow-font-meta)] text-muted-foreground">
          {copy.chat.tasksCompleted(completedCount)}
        </div>
      )}
    </div>
  )
}
