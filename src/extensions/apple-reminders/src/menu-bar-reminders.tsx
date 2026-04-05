import { useCallback, useEffect, useMemo, useState } from "react"
import {
  MenuBarExtra,
  useBackgroundRefresh,
  useNativeExtensionNavigation
} from "../../api"
import {
  getAppleRemindersData,
  showAppleReminder,
  useAppleRemindersCommandPreferences
} from "./client"
import type { AppleReminder } from "./contracts"
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
    return reminders.filter(
      (reminder) => !reminder.isCompleted && isReminderScheduled(reminder)
    ).length
  }

  return reminders.filter((reminder) => !reminder.isCompleted).length
}

export default function AppleRemindersMenuBar(): React.JSX.Element {
  const navigation = useNativeExtensionNavigation()
  const commandPreferences = useAppleRemindersCommandPreferences<MenuBarReminderPreferences>()
  const [items, setItems] = useState<AppleReminder[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(() => {
    setIsLoading(true)
    setError(null)

    return getAppleRemindersData()
      .then((data) => {
        setItems(data.reminders)
      })
      .catch((nextError) => {
        setItems([])
        setError(nextError instanceof Error ? nextError.message : "Failed to load reminders")
      })
      .finally(() => {
        setIsLoading(false)
      })
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useBackgroundRefresh(
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
    firstReminderTitle:
      visibleItems[0]
        ? commandPreferences.displayListTitleForMenuBarReminders && visibleItems[0].list
          ? `${visibleItems[0].title} [${visibleItems[0].list.title}]`
          : visibleItems[0].title
        : null,
    hideWhenEmpty: commandPreferences.hideMenuBarCountWhenEmpty,
    titleType: commandPreferences.titleType
  })

  if (error) {
    return (
      <MenuBarExtra title={title} tooltip="Apple Reminders">
        <MenuBarExtra.Section title="Apple Reminders">
          <MenuBarExtra.Item
            title={error}
            onAction={() => {
              void window.api.launcher.show().then(() => {
                navigation.openCommand({
                  commandName: "my-reminders",
                  extensionName: "apple-reminders",
                  kind: "extension-command"
                })
              })
            }}
          />
        </MenuBarExtra.Section>
      </MenuBarExtra>
    )
  }

  return (
    <MenuBarExtra isLoading={isLoading} title={title} tooltip="Apple Reminders">
      <MenuBarExtra.Section title="Reminders">
        {visibleItems.length > 0 ? (
          visibleItems.slice(0, 12).map((reminder) => (
            <MenuBarExtra.Item
              key={reminder.id}
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
            title={isLoading ? "Loading reminders…" : "No reminders"}
            onAction={() => {}}
          />
        )}
      </MenuBarExtra.Section>

      <MenuBarExtra.Section title="Actions">
        <MenuBarExtra.Item
          subtitle="Open the full reminders list"
          title="Open My Reminders"
          onAction={() => {
            void window.api.launcher.show().then(() => {
              navigation.openCommand({
                commandName: "my-reminders",
                extensionName: "apple-reminders",
                kind: "extension-command"
              })
            })
          }}
        />
        <MenuBarExtra.Item
          subtitle="Create a new reminder"
          title="Create Reminder"
          onAction={() => {
            void window.api.launcher.show().then(() => {
              navigation.openCommand({
                commandName: "create-reminder",
                extensionName: "apple-reminders",
                kind: "extension-command"
              })
            })
          }}
        />
        <MenuBarExtra.Item
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
