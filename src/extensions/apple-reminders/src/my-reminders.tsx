import { Eye, EyeOff, Plus, RefreshCw } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import {
  Action,
  ActionPanel,
  List,
  useNativeExtensionNavigation
} from "../../api"
import {
  deleteAppleReminder,
  getAppleRemindersData,
  setAppleReminderCompleted,
  showAppleReminder,
  useAppleRemindersCommandPreferences
} from "./client"
import { CreateReminderForm } from "./create-reminder"
import type { AppleReminder } from "./contracts"
import {
  buildReminderSections,
  filterRemindersByView,
  getReminderAccessories,
  getReminderFilterOptions,
  getReminderIcon,
  getReminderKeywords,
  getReminderRowActions,
  type ReminderFilterValue
} from "./helpers"

interface MyRemindersCommandPreferences {
  displayCompletionDate: boolean
  useTimeOfDayGrouping: boolean
}

function isBuiltInReminderFilter(value: ReminderFilterValue): boolean {
  return value === "all" || value === "overdue" || value === "scheduled" || value === "today"
}

export default function AppleRemindersMyReminders(): React.JSX.Element {
  const navigation = useNativeExtensionNavigation()
  const commandPreferences =
    useAppleRemindersCommandPreferences<MyRemindersCommandPreferences>()
  const [reminders, setReminders] = useState<AppleReminder[]>([])
  const [lists, setLists] = useState<Array<{ id: string; title: string }>>([])
  const [filterValue, setFilterValue] = useState<ReminderFilterValue>("today")
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reloadVersion, setReloadVersion] = useState(0)
  const [showCompleted, setShowCompleted] = useState(false)
  const [searchText, setSearchText] = useState("")

  useEffect(() => {
    let cancelled = false
    const run = async (): Promise<void> => {
      setIsLoading(true)
      setError(null)

      try {
        const data = await getAppleRemindersData()
        if (cancelled) {
          return
        }

        setLists(data.lists.map((list) => ({ id: list.id, title: list.title })))
        setReminders(data.reminders)
      } catch (nextError) {
        if (!cancelled) {
          setLists([])
          setReminders([])
          setError(
            nextError instanceof Error ? nextError.message : "Failed to load reminders"
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
  }, [reloadVersion])

  const filteredReminders = useMemo(
    () => filterRemindersByView(reminders, filterValue),
    [filterValue, reminders]
  )

  const sections = useMemo(
    () =>
      buildReminderSections({
        reminders: filteredReminders,
        showCompleted,
        useTimeOfDayGrouping: commandPreferences.useTimeOfDayGrouping
      }),
    [commandPreferences.useTimeOfDayGrouping, filteredReminders, showCompleted]
  )

  const filterOptions = useMemo(
    () =>
      getReminderFilterOptions(
        lists.map((list) => ({ color: "", id: list.id, isDefault: false, title: list.title }))
      ),
    [lists]
  )

  const rootActions = (
    <ActionPanel>
      <Action
        icon={<Plus className="h-4 w-4" />}
        onAction={() => {
          navigation.push(
            <CreateReminderForm
              initialListId={isBuiltInReminderFilter(filterValue) ? undefined : filterValue}
              initialTitle={searchText}
              onCreated={(reminder) => {
                setReminders((current) => [reminder, ...current])
              }}
            />
          )
        }}
        title="Create Reminder"
      />
      <Action
        icon={<RefreshCw className="h-4 w-4" />}
        onAction={() => setReloadVersion((value) => value + 1)}
        title="Refresh"
      />
      <Action
        icon={
          showCompleted ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />
        }
        onAction={() => setShowCompleted((value) => !value)}
        title={showCompleted ? "Hide Completed Reminders" : "Show Completed Reminders"}
      />
    </ActionPanel>
  )

  return (
    <List
      actions={rootActions}
      isLoading={isLoading}
      navigationTitle="My Reminders"
      onSearchTextChange={setSearchText}
      searchBarAccessory={
        filterOptions.length > 0 ? (
          <List.Dropdown
            onChange={(value) => setFilterValue(value as ReminderFilterValue)}
            value={filterValue}
          >
            <List.Dropdown.Section title="View">
              {filterOptions.map((option) => (
                <List.Dropdown.Item
                  key={option.value}
                  title={option.title}
                  value={option.value}
                />
              ))}
            </List.Dropdown.Section>
          </List.Dropdown>
        ) : null
      }
      searchBarPlaceholder="Filter reminders by title, notes, list, or priority"
    >
      {error ? (
        <List.EmptyView
          actions={
            <ActionPanel>
              <Action
                icon={<RefreshCw className="h-4 w-4" />}
                onAction={() => setReloadVersion((value) => value + 1)}
                title="Retry"
              />
            </ActionPanel>
          }
          description={error}
          title="Apple Reminders Request Failed"
        />
      ) : sections.length === 0 && !isLoading ? (
        <List.EmptyView
          actions={rootActions}
          description="Create a reminder or change the current filter."
          title="No reminders found"
        />
      ) : null}

      {sections.map((section) => (
        <List.Section
          key={section.id}
          subtitle={`${section.items.length}`}
          title={section.title}
        >
          {section.items.map((reminder) => (
            <List.Item
              key={reminder.id}
              actions={getReminderRowActions({
                onDelete: () => {
                  void deleteAppleReminder({ reminderId: reminder.id }).then(() => {
                    setReminders((current) =>
                      current.filter((item) => item.id !== reminder.id)
                    )
                  })
                },
                onOpen: () => {
                  void showAppleReminder({ reminderId: reminder.id })
                },
                onToggleCompleted: () => {
                  void setAppleReminderCompleted({
                    completed: !reminder.isCompleted,
                    reminderId: reminder.id
                  }).then((updatedReminder) => {
                    setReminders((current) =>
                      current.map((item) =>
                        item.id === updatedReminder.id ? updatedReminder : item
                      )
                    )
                  })
                },
                reminder
              })}
              accessories={getReminderAccessories({
                displayCompletionDate: commandPreferences.displayCompletionDate,
                reminder,
                showListName: isBuiltInReminderFilter(filterValue)
              })}
              icon={getReminderIcon(reminder)}
              keywords={getReminderKeywords(reminder)}
              subtitle={reminder.notes || undefined}
              title={reminder.title}
            />
          ))}
        </List.Section>
      ))}
    </List>
  )
}
