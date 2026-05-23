import { defineNativeExtensionManifest } from "@shared/native-extensions"
import { viewport as createReminderViewport } from "./src/create-reminder.meta"
import { viewport as myRemindersViewport } from "./src/my-reminders.meta"
import { APPLE_REMINDERS_EXTENSION_ID, APPLE_REMINDERS_SOURCE_ID } from "./src/contracts"

export const appleRemindersManifest = defineNativeExtensionManifest({
  aiCapability: {
    description: "Apple Reminders tasks and lists.",
    guide:
      "This capability is the current macOS user's local Reminders database. List reminders before modifying existing reminders unless the user provided an exact reminder id. Write operations follow the current Permission Mode.",
    id: APPLE_REMINDERS_SOURCE_ID,
    instructions: [
      "Use Apple Reminders for the user's personal tasks and reminders.",
      "List reminders before changing existing reminders unless the user provided an exact reminder id.",
      "Creating, updating, completing, or deleting reminders writes to Apple Reminders and must follow the current Permission Mode.",
      "When the user gives relative dates such as today, tomorrow, or next Friday, resolve them using the user's current timezone before calling tools.",
      "Do not invent reminder lists. If the target list is unclear, use the default list or ask a short clarification when needed."
    ],
    mention: {
      label: "Apple Reminders",
      value: "apple-reminders"
    },
    supportedPlatforms: ["darwin"],
    title: "Apple Reminders",
    toolDisplays: {
      createReminder: {
        description: "Create a reminder in Apple Reminders.",
        title: "Create Reminder"
      },
      listReminders: {
        description: "List active reminders and reminder lists from Apple Reminders.",
        title: "List Reminders"
      }
    },
    toolNames: ["listReminders", "createReminder"]
  },
  capabilities: ["navigation", "rpc", "surface"],
  iconName: "reminders",
  runtimeCapabilities: ["navigation", "preferences", "rpc"],
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
      runtime: {},
      title: "Menu Bar Reminders"
    }
  ],
  description: "Manage Apple Reminders inside Openwork.",
  name: APPLE_REMINDERS_EXTENSION_ID,
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
