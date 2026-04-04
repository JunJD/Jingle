import { CheckCircle2, Circle, Pin, PinOff, Plus, Trash2 } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import {
  Action,
  ActionPanel,
  List,
  useCommandSeedQuery,
  useNativeCommandPreferences
} from "../../api"

type SortOrder =
  | "creation_date_descending"
  | "creation_date_ascending"
  | "title_ascending"
  | "title_descending"

interface TodoListPreferences {
  showCompleted: boolean
  sortOrder: SortOrder
}

interface TodoItem {
  completed: boolean
  createdAt: string
  id: string
  pinned: boolean
  title: string
}

const STORAGE_KEY = "openwork.native.todo-list.items"

function readTodos(): TodoItem[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return []
    }

    const parsed = JSON.parse(raw) as TodoItem[]
    if (!Array.isArray(parsed)) {
      return []
    }

    return parsed.filter(
      (item): item is TodoItem =>
        Boolean(item) &&
        typeof item.id === "string" &&
        typeof item.title === "string" &&
        typeof item.createdAt === "string" &&
        typeof item.completed === "boolean" &&
        typeof item.pinned === "boolean"
    )
  } catch {
    return []
  }
}

function writeTodos(nextTodos: TodoItem[]): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(nextTodos))
}

function createTodo(title: string): TodoItem {
  return {
    completed: false,
    createdAt: new Date().toISOString(),
    id: crypto.randomUUID(),
    pinned: false,
    title: title.trim()
  }
}

function compareTodos(sortOrder: SortOrder, left: TodoItem, right: TodoItem): number {
  if (sortOrder === "creation_date_ascending") {
    return left.createdAt.localeCompare(right.createdAt)
  }

  if (sortOrder === "title_ascending") {
    return left.title.localeCompare(right.title)
  }

  if (sortOrder === "title_descending") {
    return right.title.localeCompare(left.title)
  }

  return right.createdAt.localeCompare(left.createdAt)
}

function extractFirstUrl(value: string): string | null {
  const match = value.match(/https?:\/\/\S+/i)
  return match?.[0] ?? null
}

export default function TodoList(): React.JSX.Element {
  const seedQuery = useCommandSeedQuery()
  const preferences = useNativeCommandPreferences<TodoListPreferences>()
  const [searchText, setSearchText] = useState(seedQuery)
  const [todos, setTodos] = useState<TodoItem[]>(() => readTodos())

  useEffect(() => {
    writeTodos(todos)
  }, [todos])

  const sortOrder = preferences.sortOrder
  const showCompleted = preferences.showCompleted
  const sortedTodos = useMemo(
    () => [...todos].sort((left, right) => compareTodos(sortOrder, left, right)),
    [sortOrder, todos]
  )
  const pinnedTodos = sortedTodos.filter((item) => item.pinned && !item.completed)
  const activeTodos = sortedTodos.filter((item) => !item.pinned && !item.completed)
  const completedTodos = showCompleted ? sortedTodos.filter((item) => item.completed) : []

  const addTodo = (): void => {
    const trimmedTitle = searchText.trim()
    if (!trimmedTitle) {
      return
    }

    setTodos((current) => [createTodo(trimmedTitle), ...current])
    setSearchText("")
  }

  const clearCompleted = (): void => {
    setTodos((current) => current.filter((item) => !item.completed))
  }

  const updateTodo = (todoId: string, mutate: (item: TodoItem) => TodoItem): void => {
    setTodos((current) => current.map((item) => (item.id === todoId ? mutate(item) : item)))
  }

  const deleteTodo = (todoId: string): void => {
    setTodos((current) => current.filter((item) => item.id !== todoId))
  }

  return (
    <List
      actions={
        <ActionPanel>
          <Action icon={<Plus className="h-4 w-4" />} onAction={addTodo} title="Create Todo" />
          <Action
            icon={<Trash2 className="h-4 w-4" />}
            onAction={clearCompleted}
            style={Action.Style.Destructive}
            title="Clear Completed"
          />
        </ActionPanel>
      }
      navigationTitle="Todo List"
      onSearchTextChange={setSearchText}
      searchBarPlaceholder="Type to search or create a todo"
      searchText={searchText}
    >
      {pinnedTodos.length > 0 ? (
        <List.Section title="Pinned">
          {pinnedTodos.map((item) => (
            <TodoRow
              key={item.id}
              item={item}
              onDelete={() => deleteTodo(item.id)}
              onToggleCompleted={() => {
                updateTodo(item.id, (current) => ({ ...current, completed: !current.completed }))
              }}
              onTogglePinned={() => {
                updateTodo(item.id, (current) => ({ ...current, pinned: !current.pinned }))
              }}
            />
          ))}
        </List.Section>
      ) : null}

      <List.Section title="Todo">
        {activeTodos.map((item) => (
          <TodoRow
            key={item.id}
            item={item}
            onDelete={() => deleteTodo(item.id)}
            onToggleCompleted={() => {
              updateTodo(item.id, (current) => ({ ...current, completed: !current.completed }))
            }}
            onTogglePinned={() => {
              updateTodo(item.id, (current) => ({ ...current, pinned: !current.pinned }))
            }}
          />
        ))}
      </List.Section>

      {completedTodos.length > 0 ? (
        <List.Section title="Completed">
          {completedTodos.map((item) => (
            <TodoRow
              key={item.id}
              item={item}
              onDelete={() => deleteTodo(item.id)}
              onToggleCompleted={() => {
                updateTodo(item.id, (current) => ({ ...current, completed: !current.completed }))
              }}
              onTogglePinned={() => {
                updateTodo(item.id, (current) => ({ ...current, pinned: !current.pinned }))
              }}
            />
          ))}
        </List.Section>
      ) : null}
    </List>
  )
}

function TodoRow(props: {
  item: TodoItem
  onDelete: () => void
  onToggleCompleted: () => void
  onTogglePinned: () => void
}): React.JSX.Element {
  const { item, onDelete, onToggleCompleted, onTogglePinned } = props
  const url = extractFirstUrl(item.title)

  return (
    <List.Item
      accessories={
        item.pinned ? (
          <span className="rounded-full bg-background px-2 py-1 text-[11px]">Pinned</span>
        ) : null
      }
      actions={
        <ActionPanel>
          <Action
            icon={
              item.completed ? <Circle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />
            }
            onAction={onToggleCompleted}
            title={item.completed ? "Mark as Active" : "Mark as Completed"}
          />
          <Action
            icon={item.pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
            onAction={onTogglePinned}
            title={item.pinned ? "Unpin Todo" : "Pin Todo"}
          />
          {url ? <Action.OpenInBrowser title="Open Link in Browser" url={url} /> : null}
          <Action
            icon={<Trash2 className="h-4 w-4" />}
            onAction={onDelete}
            style={Action.Style.Destructive}
            title="Delete Todo"
          />
        </ActionPanel>
      }
      icon={
        item.completed ? (
          <CheckCircle2 className="h-4 w-4 text-emerald-500" />
        ) : (
          <Circle className="h-4 w-4 text-muted-foreground" />
        )
      }
      keywords={[item.pinned ? "pinned" : "", item.completed ? "completed" : "active"]}
      subtitle={new Date(item.createdAt).toLocaleString()}
      title={item.title}
    />
  )
}
