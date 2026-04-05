import { Plus, RefreshCw } from "lucide-react"
import { useEffect, useState } from "react"
import {
  Action,
  ActionPanel,
  Detail,
  Form,
  useCommandSeedQuery,
  useNativeExtensionNavigation
} from "../../api"
import {
  createAppleReminder,
  getAppleRemindersData,
  showAppleReminder,
  useAppleRemindersCommandPreferences
} from "./client"
import type { AppleReminder, AppleReminderList } from "./contracts"

interface CreateReminderCommandPreferences {
  selectDefaultList: boolean
  selectTodayAsDefault: boolean
}

export interface CreateReminderFormProps {
  initialListId?: string
  initialTitle?: string
  onCreated?: (reminder: AppleReminder) => void
}

type DueOption = "next-week" | "none" | "today" | "tomorrow"

function dueOptionToDate(option: DueOption): string | null {
  if (option === "none") {
    return null
  }

  const value = new Date()
  value.setHours(0, 0, 0, 0)

  if (option === "tomorrow") {
    value.setDate(value.getDate() + 1)
  }

  if (option === "next-week") {
    value.setDate(value.getDate() + 7)
  }

  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, "0")
  const day = String(value.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

function CreateReminderSuccessDetail(props: {
  reminder: AppleReminder
}): React.JSX.Element {
  const navigation = useNativeExtensionNavigation()
  const { reminder } = props

  return (
    <Detail
      actions={
        <ActionPanel>
          <Action
            icon={<Plus className="h-4 w-4" />}
            onAction={() => void showAppleReminder({ reminderId: reminder.id })}
            title="Open in Reminders"
          />
          <Action onAction={() => navigation.pop()} title="Create Another Reminder" />
        </ActionPanel>
      }
      markdown={`# ${reminder.title}\n\n${reminder.notes.trim() ? reminder.notes : "_No notes provided._"}`}
      metadata={
        <Detail.Metadata>
          <Detail.Metadata.Label text={reminder.list?.title ?? "Default List"} title="List" />
          <Detail.Metadata.Label
            text={reminder.dueDate ? reminder.dueDate : "No Due Date"}
            title="Due"
          />
          <Detail.Metadata.Label text={reminder.priority ?? "None"} title="Priority" />
        </Detail.Metadata>
      }
      navigationTitle="Reminder Created"
    />
  )
}

export function CreateReminderForm(props: CreateReminderFormProps): React.JSX.Element {
  const { initialListId, initialTitle, onCreated } = props
  const navigation = useNativeExtensionNavigation()
  const commandPreferences = useAppleRemindersCommandPreferences<CreateReminderCommandPreferences>()
  const seedQuery = useCommandSeedQuery()
  const [lists, setLists] = useState<AppleReminderList[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reloadVersion, setReloadVersion] = useState(0)
  const [listId, setListId] = useState("")
  const [title, setTitle] = useState(initialTitle ?? seedQuery)
  const [notes, setNotes] = useState("")
  const [dueOption, setDueOption] = useState<DueOption>(
    commandPreferences.selectTodayAsDefault ? "today" : "none"
  )
  const [priority, setPriority] = useState<"high" | "low" | "medium" | "none">("none")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const run = async (): Promise<void> => {
      setIsLoading(true)
      setLoadError(null)

      try {
        const data = await getAppleRemindersData()
        if (cancelled) {
          return
        }

        const defaultListId =
          data.lists.find((list) => list.isDefault)?.id ?? data.lists[0]?.id ?? ""

        setLists(data.lists)
        setListId((current) => {
          if (initialListId && data.lists.some((list) => list.id === initialListId)) {
            return initialListId
          }

          if (current && data.lists.some((list) => list.id === current)) {
            return current
          }

          if (commandPreferences.selectDefaultList) {
            return defaultListId
          }

          return data.lists[0]?.id ?? ""
        })
      } catch (nextError) {
        if (!cancelled) {
          setLists([])
          setLoadError(
            nextError instanceof Error ? nextError.message : "Failed to load reminder lists"
          )
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false)
        }
      }
    }

    void run()

    return () => {
      cancelled = true
    }
  }, [
    commandPreferences.selectDefaultList,
    initialListId,
    reloadVersion
  ])

  if (isLoading && lists.length === 0) {
    return <Detail markdown="Loading reminder lists..." navigationTitle="Create Reminder" />
  }

  if (loadError) {
    return (
      <Detail
        actions={
          <ActionPanel>
            <Action
              icon={<RefreshCw className="h-4 w-4" />}
              onAction={() => setReloadVersion((value) => value + 1)}
              title="Retry"
            />
          </ActionPanel>
        }
        markdown={`# Apple Reminders Request Failed\n\n${loadError}`}
        navigationTitle="Create Reminder"
      />
    )
  }

  return (
    <Form
      actions={
        <ActionPanel>
          <Action.SubmitForm
            icon={<Plus className="h-4 w-4" />}
            onAction={() => {
              if (!title.trim() || isSubmitting) {
                return
              }

              setIsSubmitting(true)
              setSubmitError(null)
              void createAppleReminder({
                dueDate: dueOptionToDate(dueOption),
                listId: listId || undefined,
                notes: notes.trim() || undefined,
                priority: priority === "none" ? null : priority,
                title: title.trim()
              })
                .then((reminder) => {
                  onCreated?.(reminder)
                  navigation.push(<CreateReminderSuccessDetail reminder={reminder} />)
                })
                .catch((nextError) => {
                  setSubmitError(
                    nextError instanceof Error
                      ? nextError.message
                      : "Failed to create reminder"
                  )
                })
                .finally(() => {
                  setIsSubmitting(false)
                })
            }}
            title={isSubmitting ? "Creating Reminder…" : "Create Reminder"}
          />
        </ActionPanel>
      }
      navigationTitle="Create Reminder"
    >
      {submitError ? (
        <div className="rounded-[12px] border border-destructive/30 bg-destructive/8 px-3 py-3 text-sm text-destructive">
          {submitError}
        </div>
      ) : null}

      <Form.Dropdown
        description="Choose which list should receive the reminder."
        onChange={setListId}
        title="List"
        value={listId}
      >
        {lists.map((list) => (
          <Form.Dropdown.Item key={list.id} title={list.title} value={list.id} />
        ))}
      </Form.Dropdown>

      <Form.Separator />

      <Form.TextField
        description="Short summary shown in Apple Reminders."
        onChange={setTitle}
        placeholder="Reminder title"
        title="Title"
        value={title}
      />

      <Form.TextArea
        description="Optional notes shown under the reminder."
        onChange={setNotes}
        placeholder="Add notes"
        title="Notes"
        value={notes}
      />

      <Form.Dropdown
        description="Choose when this reminder should be due."
        onChange={(value) => setDueOption(value as DueOption)}
        title="Due"
        value={dueOption}
      >
        <Form.Dropdown.Item title="No Due Date" value="none" />
        <Form.Dropdown.Item title="Today" value="today" />
        <Form.Dropdown.Item title="Tomorrow" value="tomorrow" />
        <Form.Dropdown.Item title="Next Week" value="next-week" />
      </Form.Dropdown>

      <Form.Dropdown
        description="Choose a priority in Apple Reminders."
        onChange={(value) => setPriority(value as typeof priority)}
        title="Priority"
        value={priority}
      >
        <Form.Dropdown.Item title="None" value="none" />
        <Form.Dropdown.Item title="High" value="high" />
        <Form.Dropdown.Item title="Medium" value="medium" />
        <Form.Dropdown.Item title="Low" value="low" />
      </Form.Dropdown>
    </Form>
  )
}

export default function AppleRemindersCreateReminder(): React.JSX.Element {
  return <CreateReminderForm />
}
