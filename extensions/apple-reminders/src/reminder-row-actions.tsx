import { CheckCircle2, Circle, ListTodo, Trash2 } from "lucide-react"
import { Action, ActionPanel } from "@openwork/extension-api"
import type { AppleReminder } from "./contracts"

export function getReminderRowActions(props: {
  onDelete: () => void
  onOpen: () => void
  onToggleCompleted: () => void
  reminder: AppleReminder
}): React.JSX.Element {
  const { onDelete, onOpen, onToggleCompleted, reminder } = props

  return (
    <ActionPanel>
      <Action icon={<ListTodo className="h-4 w-4" />} onAction={onOpen} title="Open in Reminders" />
      <Action
        icon={
          reminder.isCompleted ? (
            <Circle className="h-4 w-4" />
          ) : (
            <CheckCircle2 className="h-4 w-4" />
          )
        }
        onAction={onToggleCompleted}
        title={reminder.isCompleted ? "Mark as Incomplete" : "Mark as Complete"}
      />
      <Action
        icon={<Trash2 className="h-4 w-4" />}
        onAction={onDelete}
        style="destructive"
        title="Delete Reminder"
      />
    </ActionPanel>
  )
}
