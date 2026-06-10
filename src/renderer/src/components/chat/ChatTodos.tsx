import { CheckCircle2, Circle, Clock, XCircle } from "lucide-react"
import { AgentStep, AgentSteps, AgentStepsContent, AgentStepsTrigger } from "@/components/agent-ui"
import { cn } from "@/lib/utils"
import type { Todo } from "@/types"
import { useI18n } from "@/lib/i18n"

interface ChatTodosProps {
  todos: readonly Todo[]
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

  const activeTodos = todos.filter((t) => t.status === "in_progress" || t.status === "pending")
  const completedCount = todos.filter((t) => t.status === "completed").length
  const totalCount = todos.length

  const progress = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0

  const progressMeta = (
    <>
      <span className="[font-size:var(--ow-font-meta)] text-muted-foreground">
        {completedCount}/{totalCount}
      </span>
      <span className="h-[var(--ow-progress-track-h-sm)] w-[var(--ow-progress-track-w)] overflow-hidden rounded-full bg-background-secondary">
        <span
          className="block h-full bg-status-nominal transition-all duration-300"
          style={{ width: `${progress}%` }}
        />
      </span>
    </>
  )

  return (
    <AgentSteps
      active={activeTodos.length > 0}
      className="mt-[var(--ow-space-3)] border-t border-border pt-[var(--ow-space-4)]"
    >
      <AgentStepsTrigger meta={progressMeta}>{copy.chat.agentTasks}</AgentStepsTrigger>
      <AgentStepsContent>
        {activeTodos.map((todo) => {
          const config = STATUS_CONFIG[todo.status]
          const Icon = config.icon

          return (
            <AgentStep
              key={todo.id}
              className="text-foreground/90"
              icon={<Icon className={cn("size-[var(--ow-icon-sm)] shrink-0", config.color)} />}
            >
              <span className="min-w-0 [overflow-wrap:anywhere]">{todo.content}</span>
            </AgentStep>
          )
        })}
        {completedCount > 0 && activeTodos.length > 0 ? (
          <AgentStep className="text-muted-foreground">
            {copy.chat.tasksCompleted(completedCount)}
          </AgentStep>
        ) : null}
      </AgentStepsContent>
    </AgentSteps>
  )
}
