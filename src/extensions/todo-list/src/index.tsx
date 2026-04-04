import { CheckCircle2, Circle, Pencil, Pin, PinOff, Plus, Search, Trash2, X } from "lucide-react"
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

type TodoListMode = "create" | "search" | "edit"

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

function renderTodoListActions(props: {
  mode: TodoListMode
  onCancelEditing: () => void
  onClearCompleted: () => void
  onEnterSearchMode: () => void
  onExitSearchMode: () => void
  onSubmit: () => void
}): React.JSX.Element {
  const {
    mode,
    onCancelEditing,
    onClearCompleted,
    onEnterSearchMode,
    onExitSearchMode,
    onSubmit
  } = props

  if (mode === "edit") {
    return (
      <ActionPanel>
        <Action
          icon={<Pencil className="h-4 w-4" />}
          onAction={onSubmit}
          title="Apply Edits"
        />
        <Action icon={<X className="h-4 w-4" />} onAction={onCancelEditing} title="Cancel" />
      </ActionPanel>
    )
  }

  if (mode === "search") {
    return (
      <ActionPanel>
        <Action icon={<X className="h-4 w-4" />} onAction={onExitSearchMode} title="Exit Search Mode" />
        <Action
          icon={<Trash2 className="h-4 w-4" />}
          onAction={onClearCompleted}
          style={Action.Style.Destructive}
          title="Clear Completed"
        />
      </ActionPanel>
    )
  }

  return (
    <ActionPanel>
      <Action icon={<Plus className="h-4 w-4" />} onAction={onSubmit} title="Create Todo" />
      <Action icon={<Search className="h-4 w-4" />} onAction={onEnterSearchMode} title="Search Todos" />
      <Action
        icon={<Trash2 className="h-4 w-4" />}
        onAction={onClearCompleted}
        style={Action.Style.Destructive}
        title="Clear Completed"
      />
    </ActionPanel>
  )
}

export default function TodoList(): React.JSX.Element {
  const seedQuery = useCommandSeedQuery()
  const preferences = useNativeCommandPreferences<TodoListPreferences>()
  const [mode, setMode] = useState<TodoListMode>("create")
  const [inputText, setInputText] = useState(seedQuery)
  const [editingTodoId, setEditingTodoId] = useState<string | null>(null)
  const [todos, setTodos] = useState<TodoItem[]>(() => readTodos())

  useEffect(() => {
    writeTodos(todos)
  }, [todos])

  useEffect(() => {
    if (mode === "edit" && editingTodoId && !todos.some((item) => item.id === editingTodoId)) {
      setMode("create")
      setEditingTodoId(null)
      setInputText("")
    }
  }, [editingTodoId, mode, todos])

  const isSearchMode = mode === "search"
  const isEditing = mode === "edit"
  const trimmedInput = inputText.trim()
  const sortOrder = preferences.sortOrder
  const showCompleted = preferences.showCompleted
  const sortedTodos = useMemo(
    () => [...todos].sort((left, right) => compareTodos(sortOrder, left, right)),
    [sortOrder, todos]
  )
  const pinnedTodos = sortedTodos.filter((item) => item.pinned && !item.completed)
  const activeTodos = sortedTodos.filter((item) => !item.pinned && !item.completed)
  const completedTodos = showCompleted ? sortedTodos.filter((item) => item.completed) : []

  const clearInputState = (): void => {
    setEditingTodoId(null)
    setInputText("")
  }

  const addTodo = (): void => {
    if (!trimmedInput) {
      return
    }

    setTodos((current) => [createTodo(trimmedInput), ...current])
    clearInputState()
  }

  const applyEdits = (): void => {
    if (!editingTodoId || !trimmedInput) {
      return
    }

    setTodos((current) =>
      current.map((item) =>
        item.id === editingTodoId
          ? {
              ...item,
              title: trimmedInput
            }
          : item
      )
    )
    setMode("create")
    clearInputState()
  }

  const submit = (): void => {
    if (isEditing) {
      applyEdits()
      return
    }

    addTodo()
  }

  const clearCompleted = (): void => {
    setTodos((current) => current.filter((item) => !item.completed))
  }

  const updateTodo = (todoId: string, mutate: (item: TodoItem) => TodoItem): void => {
    setTodos((current) => current.map((item) => (item.id === todoId ? mutate(item) : item)))
  }

  const deleteTodo = (todoId: string): void => {
    setTodos((current) => current.filter((item) => item.id !== todoId))
    if (editingTodoId === todoId) {
      setMode("create")
      clearInputState()
    }
  }

  const enterSearchMode = (): void => {
    setMode("search")
    clearInputState()
  }

  const exitSearchMode = (): void => {
    setMode("create")
    clearInputState()
  }

  const startEditingTodo = (todo: TodoItem): void => {
    setMode("edit")
    setEditingTodoId(todo.id)
    setInputText(todo.title)
  }

  const listActions = renderTodoListActions({
    mode,
    onCancelEditing: () => {
      setMode("create")
      clearInputState()
    },
    onClearCompleted: clearCompleted,
    onEnterSearchMode: enterSearchMode,
    onExitSearchMode: exitSearchMode,
    onSubmit: submit
  })

  const showRowActions = isSearchMode || (!trimmedInput && !isEditing)
  const showCreateRow = mode === "create" && trimmedInput.length > 0
  const hasVisibleTodos = pinnedTodos.length > 0 || activeTodos.length > 0 || completedTodos.length > 0
  const navigationTitle = `Todo List${isEditing ? " • Editing" : isSearchMode ? " • Searching" : ""}`
  const searchBarPlaceholder = isSearchMode
    ? "Search todos"
    : isEditing
      ? "Edit todo and hit enter to apply"
      : "Type and hit enter to add an item to your list"

  return (
    <List
      actions={listActions}
      filtering={isSearchMode}
      navigationTitle={navigationTitle}
      onSearchTextChange={setInputText}
      searchBarPlaceholder={searchBarPlaceholder}
      searchText={inputText}
    >
      {showCreateRow ? (
        <List.Item
          actions={listActions}
          icon={<Plus className="h-4 w-4 text-muted-foreground" />}
          keywords={["create", "new", "add", trimmedInput]}
          subtitle={trimmedInput}
          title="Create Todo"
        />
      ) : null}

      {isSearchMode && !hasVisibleTodos ? (
        <List.EmptyView
          actions={listActions}
          description="Try another search, or exit search mode to go back to creating todos."
          title="No todos found"
        />
      ) : !showCreateRow && !hasVisibleTodos ? (
        <List.EmptyView
          description="Type a todo and hit enter to create it."
          title="Your list is empty"
        />
      ) : null}

      {pinnedTodos.length > 0 ? (
        <List.Section title="Pinned">
          {pinnedTodos.map((item) =>
            renderTodoRow({
              item,
              listActions,
              mode,
              onDelete: () => deleteTodo(item.id),
              onEdit: () => startEditingTodo(item),
              onEnterSearchMode: enterSearchMode,
              onExitSearchMode: exitSearchMode,
              onToggleCompleted: () => {
                updateTodo(item.id, (current) => ({ ...current, completed: !current.completed }))
              },
              onTogglePinned: () => {
                updateTodo(item.id, (current) => ({ ...current, pinned: !current.pinned }))
              },
              showItemActions: showRowActions
            })
          )}
        </List.Section>
      ) : null}

      <List.Section title="Todo">
        {activeTodos.map((item) =>
          renderTodoRow({
            item,
            listActions,
            mode,
            onDelete: () => deleteTodo(item.id),
            onEdit: () => startEditingTodo(item),
            onEnterSearchMode: enterSearchMode,
            onExitSearchMode: exitSearchMode,
            onToggleCompleted: () => {
              updateTodo(item.id, (current) => ({ ...current, completed: !current.completed }))
            },
            onTogglePinned: () => {
              updateTodo(item.id, (current) => ({ ...current, pinned: !current.pinned }))
            },
            showItemActions: showRowActions
          })
        )}
      </List.Section>

      {completedTodos.length > 0 ? (
        <List.Section title="Completed">
          {completedTodos.map((item) =>
            renderTodoRow({
              item,
              listActions,
              mode,
              onDelete: () => deleteTodo(item.id),
              onEdit: () => startEditingTodo(item),
              onEnterSearchMode: enterSearchMode,
              onExitSearchMode: exitSearchMode,
              onToggleCompleted: () => {
                updateTodo(item.id, (current) => ({ ...current, completed: !current.completed }))
              },
              onTogglePinned: () => {
                updateTodo(item.id, (current) => ({ ...current, pinned: !current.pinned }))
              },
              showItemActions: showRowActions
            })
          )}
        </List.Section>
      ) : null}
    </List>
  )
}

function renderTodoRow(props: {
  item: TodoItem
  listActions: React.ReactElement
  mode: TodoListMode
  onDelete: () => void
  onEdit: () => void
  onEnterSearchMode: () => void
  onExitSearchMode: () => void
  onToggleCompleted: () => void
  onTogglePinned: () => void
  showItemActions: boolean
}): React.JSX.Element {
  const {
    item,
    listActions,
    mode,
    onDelete,
    onEdit,
    onEnterSearchMode,
    onExitSearchMode,
    onToggleCompleted,
    onTogglePinned,
    showItemActions
  } = props
  const url = extractFirstUrl(item.title)

  return (
    <List.Item
      key={item.id}
      accessories={
        item.pinned ? (
          <span className="rounded-full bg-background px-2 py-1 text-[11px]">Pinned</span>
        ) : null
      }
      actions={
        showItemActions ? (
          <ActionPanel>
            <Action
              icon={
                item.completed ? <Circle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />
              }
              onAction={onToggleCompleted}
              title={item.completed ? "Mark as Active" : "Mark as Completed"}
            />
            <Action icon={<Pencil className="h-4 w-4" />} onAction={onEdit} title="Edit Todo" />
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
            {mode === "search" ? (
              <Action icon={<X className="h-4 w-4" />} onAction={onExitSearchMode} title="Exit Search Mode" />
            ) : (
              <Action
                icon={<Search className="h-4 w-4" />}
                onAction={onEnterSearchMode}
                title="Search Todos"
              />
            )}
          </ActionPanel>
        ) : (
          listActions
        )
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
