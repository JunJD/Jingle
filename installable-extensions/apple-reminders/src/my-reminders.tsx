import { Eye, EyeOff, Plus, RefreshCw } from "lucide-react"
import { useMemo, useState } from "react"
import {
  Action,
  ActionPanel,
  List,
  useNativeExtensionNavigation
} from "@jingle/extension-api"
import {
  deleteAppleReminder,
  getAppleRemindersData,
  setAppleReminderCompleted,
  showAppleReminder,
  useAppleRemindersCommandPreferences
} from "./runtime-client"
import { CreateReminderForm } from "./create-reminder"
import { useRefreshableData } from "@jingle/extension-utils"
import type { AppleRemindersData } from "../contracts"
import {
  buildReminderSections,
  filterRemindersByView,
  getReminderAccessories,
  getReminderFilterOptions,
  getReminderIcon,
  getReminderKeywords,
  type ReminderFilterValue
} from "./helpers"
import { getReminderRowActions } from "./reminder-row-actions"

interface MyRemindersCommandPreferences {
  displayCompletionDate: boolean
  useTimeOfDayGrouping: boolean
}

const EMPTY_REMINDERS_DATA: AppleRemindersData = {
  lists: [],
  reminders: []
}

function isBuiltInReminderFilter(value: ReminderFilterValue): boolean {
  return value === "all" || value === "overdue" || value === "scheduled" || value === "today"
}

export default function AppleRemindersMyReminders(): React.JSX.Element {
  const navigation = useNativeExtensionNavigation()
  const commandPreferences =
    useAppleRemindersCommandPreferences<MyRemindersCommandPreferences>()
  const [filterValue, setFilterValue] = useState<ReminderFilterValue>("today")
  const [showCompleted, setShowCompleted] = useState(false)
  const [searchText, setSearchText] = useState("")
  const {
    data,
    error,
    isLoading,
    refresh,
    setData: setReminderData
  } = useRefreshableData({
    emptyData: EMPTY_REMINDERS_DATA,
    failureMessage: "Failed to load reminders",
    load: getAppleRemindersData
  })
  const { lists, reminders } = data

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
        lists.map((list) => ({
          color: list.color,
          id: list.id,
          isDefault: list.isDefault,
          title: list.title
        }))
      ),
    [lists]
  )

  const rootActions = useMemo(
    () => (
      <ActionPanel>
        <Action
          icon={<Plus className="h-4 w-4" />}
          onAction={() => {
            navigation.push(
              <CreateReminderForm
                initialListId={isBuiltInReminderFilter(filterValue) ? undefined : filterValue}
                initialTitle={searchText}
                onCreated={(reminder) => {
                  setReminderData((current) => ({
                    lists: current.lists,
                    reminders: [reminder, ...current.reminders]
                  }))
                }}
              />
            )
          }}
          title="Create Reminder"
        />
        <Action icon={<RefreshCw className="h-4 w-4" />} onAction={refresh} title="Refresh" />
        <Action
          icon={
            showCompleted ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />
          }
          onAction={() => setShowCompleted((value) => !value)}
          title={showCompleted ? "Hide Completed Reminders" : "Show Completed Reminders"}
        />
      </ActionPanel>
    ),
    [filterValue, navigation, refresh, searchText, setReminderData, showCompleted]
  )
  const searchBarAccessory = useMemo(
    () =>
      filterOptions.length > 0 ? (
        <List.Dropdown
          onChange={(value) => setFilterValue(value as ReminderFilterValue)}
          value={filterValue}
        >
          <List.Dropdown.Section title="View">
            {filterOptions.map((option) => (
              <List.Dropdown.Item key={option.value} title={option.title} value={option.value} />
            ))}
          </List.Dropdown.Section>
        </List.Dropdown>
      ) : null,
    [filterOptions, filterValue]
  )

  return (
    <List
      actions={rootActions}
      isLoading={isLoading}
      navigationTitle="My Reminders"
      onSearchTextChange={setSearchText}
      searchBarAccessory={searchBarAccessory}
      searchBarPlaceholder="Filter reminders by title, notes, list, or priority"
    >
      {error ? (
        <List.EmptyView
          actions={
            <ActionPanel>
              <Action
                icon={<RefreshCw className="h-4 w-4" />}
                onAction={refresh}
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
                    setReminderData((current) => ({
                      lists: current.lists,
                      reminders: current.reminders.filter((item) => item.id !== reminder.id)
                    }))
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
                    setReminderData((current) => ({
                      lists: current.lists,
                      reminders: current.reminders.map((item) =>
                        item.id === updatedReminder.id ? updatedReminder : item
                      )
                    }))
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
