import { useCallback, useEffect, useMemo, useReducer } from "react"
import { MenuBarExtra, useInterval, useNativeExtensionNavigation } from "@jingle/extension-api"
import {
  getAppleRemindersData,
  showAppleReminder,
  useAppleRemindersCommandPreferences
} from "./runtime-client"
import type { AppleReminder } from "../contracts"
import {
  buildReminderMenuBarTitle,
  compareRemindersByDueDate,
  isReminderDueToday,
  isReminderOverdue,
  isReminderScheduled
} from "./helpers"

interface MenuBarReminderPreferences {
  countType: "all" | "today" | "upcoming"
  displayListTitleForMenuBarReminders: boolean
  hideMenuBarCountWhenEmpty: boolean
  refreshIntervalSeconds: number | string
  sortMenuBarRemindersByDueDate: boolean
  titleType: "count" | "firstReminder" | "nothing"
  view: "all" | "today" | "upcoming"
}

interface MenuBarReminderState {
  error: string | null
  isLoading: boolean
  items: AppleReminder[]
}

type MenuBarReminderAction =
  | { type: "failure"; error: string }
  | { type: "loading" }
  | { type: "success"; items: AppleReminder[] }

function menuBarReminderReducer(
  state: MenuBarReminderState,
  action: MenuBarReminderAction
): MenuBarReminderState {
  switch (action.type) {
    case "failure":
      return { error: action.error, isLoading: false, items: [] }
    case "loading":
      return { ...state, error: null, isLoading: true }
    case "success":
      return { error: null, isLoading: false, items: action.items }
  }
}

function normalizeRefreshIntervalSeconds(value: number | string): number {
  const numericValue = typeof value === "number" ? value : Number.parseInt(String(value), 10)
  if (!Number.isFinite(numericValue)) {
    return 60
  }

  return Math.max(15, Math.min(3600, numericValue))
}

function filterMenuBarReminders(
  reminders: AppleReminder[],
  view: MenuBarReminderPreferences["view"]
): AppleReminder[] {
  const incomplete = reminders.filter((reminder) => !reminder.isCompleted)

  if (view === "today") {
    return incomplete.filter(
      (reminder) => isReminderOverdue(reminder) || isReminderDueToday(reminder)
    )
  }

  if (view === "upcoming") {
    return incomplete.filter((reminder) => isReminderScheduled(reminder))
  }

  return incomplete
}

function getMenuBarReminderCount(
  reminders: AppleReminder[],
  countType: MenuBarReminderPreferences["countType"]
): number {
  if (countType === "today") {
    return reminders.filter(
      (reminder) =>
        !reminder.isCompleted && (isReminderOverdue(reminder) || isReminderDueToday(reminder))
    ).length
  }

  if (countType === "upcoming") {
    return reminders.filter((reminder) => !reminder.isCompleted && isReminderScheduled(reminder))
      .length
  }

  return reminders.filter((reminder) => !reminder.isCompleted).length
}

export default function AppleRemindersMenuBar(): React.JSX.Element {
  const navigation = useNativeExtensionNavigation()
  const commandPreferences = useAppleRemindersCommandPreferences<MenuBarReminderPreferences>()
  const [state, dispatch] = useReducer(menuBarReminderReducer, {
    error: null,
    isLoading: false,
    items: []
  })
  const { error, isLoading, items } = state

  const refresh = useCallback(() => {
    dispatch({ type: "loading" })

    return getAppleRemindersData()
      .then((data) => {
        dispatch({ type: "success", items: data.reminders })
      })
      .catch((nextError) => {
        dispatch({
          type: "failure",
          error: nextError instanceof Error ? nextError.message : "Failed to load reminders"
        })
      })
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useInterval(
    refresh,
    normalizeRefreshIntervalSeconds(commandPreferences.refreshIntervalSeconds) * 1000
  )

  const visibleItems = useMemo(() => {
    const filtered = filterMenuBarReminders(items, commandPreferences.view).slice()

    if (commandPreferences.sortMenuBarRemindersByDueDate) {
      filtered.sort(compareRemindersByDueDate)
    }

    return filtered
  }, [commandPreferences.sortMenuBarRemindersByDueDate, commandPreferences.view, items])

  const title = buildReminderMenuBarTitle({
    count: getMenuBarReminderCount(items, commandPreferences.countType),
    firstReminderTitle: visibleItems[0]
      ? commandPreferences.displayListTitleForMenuBarReminders && visibleItems[0].list
        ? `${visibleItems[0].title} [${visibleItems[0].list.title}]`
        : visibleItems[0].title
      : null,
    hideWhenEmpty: commandPreferences.hideMenuBarCountWhenEmpty,
    titleType: commandPreferences.titleType
  })

  if (error) {
    return (
      <MenuBarExtra icon="assets/icon-menubar.png" title={title} tooltip="Apple Reminders">
        <MenuBarExtra.Section title="Apple Reminders">
          <MenuBarExtra.Item
            icon="assets/icon-menubar.png"
            title={error}
            onAction={() => {
              void navigation.openCommand(
                {
                  commandName: "my-reminders",
                  extensionName: "apple-reminders"
                },
                { showLauncher: true }
              )
            }}
          />
        </MenuBarExtra.Section>
      </MenuBarExtra>
    )
  }

  return (
    <MenuBarExtra
      icon="assets/icon-menubar.png"
      isLoading={isLoading}
      title={title}
      tooltip="Apple Reminders"
    >
      <MenuBarExtra.Section title="Reminders">
        {visibleItems.length > 0 ? (
          visibleItems.slice(0, 12).map((reminder) => (
            <MenuBarExtra.Item
              key={reminder.id}
              icon="assets/icon-menubar.png"
              subtitle={
                commandPreferences.displayListTitleForMenuBarReminders
                  ? reminder.list?.title
                  : undefined
              }
              title={reminder.title}
              onAction={() => {
                void showAppleReminder({ reminderId: reminder.id })
              }}
            />
          ))
        ) : (
          <MenuBarExtra.Item
            disabled
            icon="assets/icon-menubar.png"
            title={isLoading ? "Loading reminders…" : "No reminders"}
            onAction={() => {}}
          />
        )}
      </MenuBarExtra.Section>

      <MenuBarExtra.Section title="Actions">
        <MenuBarExtra.Item
          icon="assets/icon-menubar.png"
          subtitle="Open the full reminders list"
          title="Open My Reminders"
          onAction={() => {
            void navigation.openCommand(
              {
                commandName: "my-reminders",
                extensionName: "apple-reminders"
              },
              { showLauncher: true }
            )
          }}
        />
        <MenuBarExtra.Item
          iconName="plus"
          subtitle="Create a new reminder"
          title="Create Reminder"
          onAction={() => {
            void navigation.openCommand(
              {
                commandName: "create-reminder",
                extensionName: "apple-reminders"
              },
              { showLauncher: true }
            )
          }}
        />
        <MenuBarExtra.Item
          iconName="refresh"
          subtitle="Refresh menu bar reminders"
          title="Refresh"
          onAction={() => {
            void refresh()
          }}
        />
      </MenuBarExtra.Section>
    </MenuBarExtra>
  )
}
