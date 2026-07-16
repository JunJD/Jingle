import { CheckCircle2, Circle, Clock3, XCircle } from "lucide-react"
import { useState } from "react"
import type { Todo } from "@/types"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

const PROGRESS_VISIBLE_LIMIT = 6

const TODO_STATUS_CONFIG = {
  pending: {
    icon: Circle,
    iconClassName: "text-muted-foreground"
  },
  in_progress: {
    icon: Clock3,
    iconClassName: "text-status-info"
  },
  completed: {
    icon: CheckCircle2,
    iconClassName: "text-muted-foreground"
  },
  cancelled: {
    icon: XCircle,
    iconClassName: "text-muted-foreground"
  }
}

export function LauncherAiProgressList(props: {
  className?: string
  label: string
  moreLabel: (count: number) => string
  todos: readonly Todo[]
}): React.JSX.Element | null {
  const { className, label, moreLabel, todos } = props
  const [isExpanded, setIsExpanded] = useState(false)

  if (todos.length === 0) {
    return null
  }

  const visibleTodos = isExpanded ? todos : todos.slice(0, PROGRESS_VISIBLE_LIMIT)
  const hiddenCount = todos.length - visibleTodos.length

  return (
    <div className={cn("launcher-ai-progress", className)}>
      <div className="launcher-ai-progress__heading">{label}</div>
      <div className="launcher-ai-progress__list">
        {visibleTodos.map((todo) => {
          const config = TODO_STATUS_CONFIG[todo.status]
          const Icon = config.icon

          return (
            <div className="launcher-ai-progress__item" key={todo.id}>
              <Icon className={cn("launcher-ai-progress__icon", config.iconClassName)} />
              <span className="launcher-ai-progress__copy">{todo.content}</span>
            </div>
          )
        })}
      </div>
      {hiddenCount > 0 ? (
        <Button
          className="launcher-ai-progress__more"
          type="button"
          variant="ghost"
          onClick={() => setIsExpanded(true)}
        >
          {moreLabel(hiddenCount)}
        </Button>
      ) : null}
    </div>
  )
}
