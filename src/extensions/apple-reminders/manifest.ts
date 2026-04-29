import { defineNativeExtensionManifest } from "@shared/native-extensions"
import { viewport as createReminderViewport } from "./src/create-reminder.meta"
import { viewport as myRemindersViewport } from "./src/my-reminders.meta"

export const appleRemindersManifest = defineNativeExtensionManifest({
  capabilities: ["navigation", "rpc", "surface"],
  iconName: "reminders",
  commands: [
    {
      description: "View, complete, and organize reminders from Apple Reminders.",
      iconName: "reminders",
      keywords: ["apple", "reminders", "todo", "tasks"],
      mode: "view",
      name: "my-reminders",
      preferences: [
        {
          default: false,
          description: "When enabled, completed reminders show their completion date.",
          name: "displayCompletionDate",
          title: "Display Completion Date",
          type: "checkbox"
        },
        {
          default: false,
          description:
            "When enabled, today's reminders are grouped by the time of day they are due.",
          name: "useTimeOfDayGrouping",
          title: "Use Time of Day Grouping",
          type: "checkbox"
        }
      ],
      runtime: {
        viewport: myRemindersViewport
      },
      title: "My Reminders"
    },
    {
      description: "Create a new reminder in Apple Reminders.",
      iconName: "reminders",
      keywords: ["apple", "reminders", "create", "new reminder", "todo"],
      mode: "view",
      name: "create-reminder",
      preferences: [
        {
          default: false,
          description: "Initially select the default Reminders list instead of the last used list.",
          name: "selectDefaultList",
          title: "Initially Select Default List",
          type: "checkbox"
        },
        {
          default: false,
          description: 'Initially select "Today" instead of no due date.',
          name: "selectTodayAsDefault",
          title: 'Initially Select "Today"',
          type: "checkbox"
        }
      ],
      runtime: {
        viewport: createReminderViewport
      },
      title: "Create Reminder"
    },
    {
      description: "Quickly add a reminder from the current launcher query.",
      iconName: "reminders",
      keywords: ["apple", "reminders", "quick add", "add", "capture"],
      mode: "no-view",
      name: "quick-add-reminder",
      runtime: {},
      title: "Quick Add Reminder"
    },
    {
      description: "Show Apple Reminders in the menu bar.",
      iconName: "reminders",
      keywords: ["apple", "reminders", "menu bar", "tray"],
      mode: "menu-bar",
      name: "menu-bar-reminders",
      preferences: [
        {
          data: [
            { title: "Nothing", value: "nothing" },
            { title: "Count", value: "count" },
            { title: "First Reminder", value: "firstReminder" }
          ],
          default: "count",
          description: "Choose what is shown in the menu bar title.",
          name: "titleType",
          title: "Title",
          type: "dropdown"
        },
        {
          data: [
            { title: "Today", value: "today" },
            { title: "Upcoming", value: "upcoming" },
            { title: "All", value: "all" }
          ],
          default: "today",
          description: "Choose which reminders appear in the menu bar.",
          name: "view",
          title: "View",
          type: "dropdown"
        },
        {
          data: [
            { title: "Today", value: "today" },
            { title: "Upcoming", value: "upcoming" },
            { title: "All", value: "all" }
          ],
          default: "today",
          description: "Choose which reminder count is shown in the menu bar.",
          name: "countType",
          title: "Count",
          type: "dropdown"
        },
        {
          default: false,
          description: "Hide the menu bar count when there are no reminders in the selected view.",
          name: "hideMenuBarCountWhenEmpty",
          title: "Hide Count When Empty",
          type: "checkbox"
        },
        {
          default: false,
          description: "Sort reminders in the menu bar by due date instead of creation date.",
          name: "sortMenuBarRemindersByDueDate",
          title: "Sort by Due Date",
          type: "checkbox"
        },
        {
          default: false,
          description: "Show the originating list name next to reminder titles in the menu bar.",
          name: "displayListTitleForMenuBarReminders",
          title: "Display List Name",
          type: "checkbox"
        },
        {
          default: "60",
          description: "How often the menu bar refreshes reminders, in seconds.",
          name: "refreshIntervalSeconds",
          title: "Refresh Interval Seconds",
          type: "text"
        }
      ],
      title: "Menu Bar Reminders"
    }
  ],
  description: "Manage Apple Reminders inside Openwork.",
  name: "apple-reminders",
  rpcMethods: [
    "create-reminder",
    "delete-reminder",
    "get-data",
    "set-reminder-completed",
    "show-reminder"
  ],
  supportedPlatforms: ["darwin"],
  title: "Apple Reminders"
})
