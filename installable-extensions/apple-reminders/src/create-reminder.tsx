import { Plus, RefreshCw } from "lucide-react"
import { useCallback, useMemo, useReducer } from "react"
import {
  Action,
  ActionPanel,
  Detail,
  Form,
  useCommandSeedQuery,
  useNativeExtensionNavigation
} from "@jingle/extension-api"
import {
  createAppleReminder,
  getAppleRemindersData,
  showAppleReminder,
  useAppleRemindersCommandPreferences
} from "./runtime-client"
import { useRefreshableData } from "@jingle/extension-utils"
import type { AppleReminder, AppleReminderList } from "../contracts"

const EMPTY_LISTS: AppleReminderList[] = []

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
type PriorityOption = "high" | "low" | "medium" | "none"

interface CreateReminderFormState {
  dueOption: DueOption
  isSubmitting: boolean
  listId: string
  notes: string
  priority: PriorityOption
  submitError: string | null
  title: string
}

type CreateReminderFormAction =
  | { type: "finishSubmitting" }
  | { type: "setDueOption"; value: DueOption }
  | { type: "setListId"; value: string }
  | { type: "setNotes"; value: string }
  | { type: "setPriority"; value: PriorityOption }
  | { type: "setSubmitError"; value: string | null }
  | { type: "setTitle"; value: string }
  | { type: "startSubmitting" }

function createReminderFormReducer(
  state: CreateReminderFormState,
  action: CreateReminderFormAction
): CreateReminderFormState {
  switch (action.type) {
    case "finishSubmitting":
      return { ...state, isSubmitting: false }
    case "setDueOption":
      return { ...state, dueOption: action.value }
    case "setListId":
      return { ...state, listId: action.value }
    case "setNotes":
      return { ...state, notes: action.value }
    case "setPriority":
      return { ...state, priority: action.value }
    case "setSubmitError":
      return { ...state, submitError: action.value }
    case "setTitle":
      return { ...state, title: action.value }
    case "startSubmitting":
      return { ...state, isSubmitting: true, submitError: null }
  }
}

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

function CreateReminderSuccessDetail(props: { reminder: AppleReminder }): React.JSX.Element {
  const navigation = useNativeExtensionNavigation()
  const { reminder } = props
  const metadata = useMemo(
    () => (
      <Detail.Metadata>
        <Detail.Metadata.Label text={reminder.list?.title ?? "Default List"} title="List" />
        <Detail.Metadata.Label
          text={reminder.dueDate ? reminder.dueDate : "No Due Date"}
          title="Due"
        />
        <Detail.Metadata.Label text={reminder.priority ?? "None"} title="Priority" />
      </Detail.Metadata>
    ),
    [reminder]
  )

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
      metadata={metadata}
      navigationTitle="Reminder Created"
    />
  )
}

export function CreateReminderForm(props: CreateReminderFormProps): React.JSX.Element {
  const { initialListId, initialTitle, onCreated } = props
  const navigation = useNativeExtensionNavigation()
  const commandPreferences = useAppleRemindersCommandPreferences<CreateReminderCommandPreferences>()
  const seedQuery = useCommandSeedQuery()
  const [formState, dispatch] = useReducer(createReminderFormReducer, {
    dueOption: commandPreferences.selectTodayAsDefault ? "today" : "none",
    isSubmitting: false,
    listId: "",
    notes: "",
    priority: "none",
    submitError: null,
    title: initialTitle ?? seedQuery
  })
  const loadLists = useCallback(async () => {
    const data = await getAppleRemindersData()
    return data.lists
  }, [])
  const {
    data: lists,
    error: loadError,
    isLoading,
    refresh
  } = useRefreshableData({
    emptyData: EMPTY_LISTS,
    failureMessage: "Failed to load reminder lists",
    load: loadLists
  })
  const selectedListId = useMemo(() => {
    if (initialListId && lists.some((list) => list.id === initialListId)) {
      return initialListId
    }

    if (formState.listId && lists.some((list) => list.id === formState.listId)) {
      return formState.listId
    }

    if (commandPreferences.selectDefaultList) {
      return lists.find((list) => list.isDefault)?.id ?? lists[0]?.id ?? ""
    }

    return lists[0]?.id ?? ""
  }, [commandPreferences.selectDefaultList, formState.listId, initialListId, lists])

  if (isLoading && lists.length === 0) {
    return <Detail markdown="Loading reminder lists..." navigationTitle="Create Reminder" />
  }

  if (loadError) {
    return (
      <Detail
        actions={
          <ActionPanel>
            <Action icon={<RefreshCw className="h-4 w-4" />} onAction={refresh} title="Retry" />
          </ActionPanel>
        }
        markdown={`# Apple Reminders Request Failed\n\n${loadError}`}
        navigationTitle="Create Reminder"
      />
    )
  }

  if (formState.submitError) {
    return (
      <Detail
        actions={
          <ActionPanel>
            <Action
              onAction={() => dispatch({ type: "setSubmitError", value: null })}
              title="Edit Reminder"
            />
          </ActionPanel>
        }
        markdown={`# Apple Reminders Request Failed\n\n${formState.submitError}`}
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
              if (!formState.title.trim() || formState.isSubmitting) {
                return
              }

              dispatch({ type: "startSubmitting" })
              void createAppleReminder({
                dueDate: dueOptionToDate(formState.dueOption),
                listId: selectedListId || undefined,
                notes: formState.notes.trim() || undefined,
                priority: formState.priority === "none" ? null : formState.priority,
                title: formState.title.trim()
              })
                .then((reminder) => {
                  onCreated?.(reminder)
                  navigation.push(<CreateReminderSuccessDetail reminder={reminder} />)
                })
                .catch((nextError) => {
                  dispatch({
                    type: "setSubmitError",
                    value:
                      nextError instanceof Error ? nextError.message : "Failed to create reminder"
                  })
                })
                .finally(() => {
                  dispatch({ type: "finishSubmitting" })
                })
            }}
            title={formState.isSubmitting ? "Creating Reminder…" : "Create Reminder"}
          />
        </ActionPanel>
      }
      navigationTitle="Create Reminder"
    >
      <Form.Dropdown
        description="Choose which list should receive the reminder."
        onChange={(value) => dispatch({ type: "setListId", value })}
        title="List"
        value={selectedListId}
      >
        {lists.map((list) => (
          <Form.Dropdown.Item key={list.id} title={list.title} value={list.id} />
        ))}
      </Form.Dropdown>

      <Form.Separator />

      <Form.TextField
        description="Short summary shown in Apple Reminders."
        onChange={(value) => dispatch({ type: "setTitle", value })}
        placeholder="Reminder title"
        title="Title"
        value={formState.title}
      />

      <Form.TextArea
        description="Optional notes shown under the reminder."
        onChange={(value) => dispatch({ type: "setNotes", value })}
        placeholder="Add notes"
        title="Notes"
        value={formState.notes}
      />

      <Form.Dropdown
        description="Choose when this reminder should be due."
        onChange={(value) => dispatch({ type: "setDueOption", value: value as DueOption })}
        title="Due"
        value={formState.dueOption}
      >
        <Form.Dropdown.Item title="No Due Date" value="none" />
        <Form.Dropdown.Item title="Today" value="today" />
        <Form.Dropdown.Item title="Tomorrow" value="tomorrow" />
        <Form.Dropdown.Item title="Next Week" value="next-week" />
      </Form.Dropdown>

      <Form.Dropdown
        description="Choose a priority in Apple Reminders."
        onChange={(value) => dispatch({ type: "setPriority", value: value as PriorityOption })}
        title="Priority"
        value={formState.priority}
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
