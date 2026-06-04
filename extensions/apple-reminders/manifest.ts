import { defineLocalizedText as l, defineNativeExtensionManifest } from "@openwork/extension-api"
import { viewport as createReminderViewport } from "./src/create-reminder.meta"
import { viewport as myRemindersViewport } from "./src/my-reminders.meta"
import { APPLE_REMINDERS_EXTENSION_ID, APPLE_REMINDERS_SOURCE_ID } from "./contracts"

export const appleRemindersManifest = defineNativeExtensionManifest({
  aiCapability: {
    connectionId: "default",
    description: "Apple Reminders tasks and lists.",
    guide:
      "This capability is the current macOS user's local Reminders database. List reminders before modifying existing reminders unless the user provided an exact reminder id. Write operations follow the current Permission Mode.",
    id: APPLE_REMINDERS_SOURCE_ID,
    instructions: [
      "Use Apple Reminders for the user's personal tasks and reminders.",
      "List reminders before changing existing reminders unless the user provided an exact reminder id.",
      "Creating, updating, completing, or deleting reminders writes to Apple Reminders and must follow the current Permission Mode.",
      "Opening a reminder launches the Reminders app and should only be used when the user asks to inspect that specific reminder.",
      "When the user gives relative dates such as today, tomorrow, or next Friday, resolve them using the user's current timezone before calling tools.",
      "Do not invent reminder lists. If the target list is unclear, use the default list or ask a short clarification when needed."
    ],
    mention: {
      label: l("Apple Reminders", "提醒事项"),
      value: "apple-reminders"
    },
    supportedPlatforms: ["darwin"],
    title: l("Apple Reminders", "提醒事项"),
    toolDisplays: {
      createReminder: {
        description: l("Create a reminder in Apple Reminders.", "在 Apple 提醒事项中新建提醒。"),
        title: l("Create Reminder", "创建提醒")
      },
      completeReminder: {
        description: l(
          "Mark a reminder as complete in Apple Reminders.",
          "将 Apple 提醒事项中的提醒标记为完成。"
        ),
        title: l("Complete Reminder", "完成提醒")
      },
      deleteReminder: {
        description: l("Delete a reminder from Apple Reminders.", "从 Apple 提醒事项中删除提醒。"),
        title: l("Delete Reminder", "删除提醒")
      },
      listReminders: {
        description: l(
          "List active reminders and reminder lists from Apple Reminders.",
          "列出 Apple 提醒事项中的活跃提醒和提醒列表。"
        ),
        title: l("List Reminders", "列出提醒")
      },
      openReminder: {
        description: l("Open a reminder in the Reminders app.", "在提醒事项 app 中打开提醒。"),
        title: l("Open Reminder", "打开提醒")
      }
    },
    toolNames: [
      "listReminders",
      "createReminder",
      "completeReminder",
      "deleteReminder",
      "openReminder"
    ]
  },
  capabilities: ["navigation", "rpc", "surface"],
  connection: {
    auth: {
      type: "none"
    },
    id: "default",
    provider: APPLE_REMINDERS_EXTENSION_ID,
    title: l("Apple Reminders", "提醒事项")
  },
  icon: "assets/icon.png",
  iconName: "reminders",
  runtimeCapabilities: ["navigation", "preferences", "rpc"],
  commands: [
    {
      description: l(
        "View, complete, and organize reminders from Apple Reminders.",
        "查看、完成和整理 Apple 提醒事项。"
      ),
      keywords: ["apple", "reminders", "todo", "tasks"],
      mode: "view",
      name: "my-reminders",
      preferences: [
        {
          default: false,
          description: l(
            "When enabled, completed reminders show their completion date.",
            "开启后，已完成提醒会显示完成日期。"
          ),
          name: "displayCompletionDate",
          title: l("Display Completion Date", "显示完成日期"),
          type: "checkbox"
        },
        {
          default: false,
          description: l(
            "When enabled, today's reminders are grouped by the time of day they are due.",
            "开启后，今天的提醒会按到期时段分组。"
          ),
          name: "useTimeOfDayGrouping",
          title: l("Use Time of Day Grouping", "按时段分组"),
          type: "checkbox"
        }
      ],
      runtime: {
        viewport: myRemindersViewport
      },
      title: l("My Reminders", "我的提醒")
    },
    {
      description: l("Create a new reminder in Apple Reminders.", "在 Apple 提醒事项中新建提醒。"),
      keywords: ["apple", "reminders", "create", "new reminder", "todo"],
      mode: "view",
      name: "create-reminder",
      preferences: [
        {
          default: false,
          description: l(
            "Initially select the default Reminders list instead of the last used list.",
            "默认选择系统提醒列表，而不是上次使用的列表。"
          ),
          name: "selectDefaultList",
          title: l("Initially Select Default List", "默认选择系统列表"),
          type: "checkbox"
        },
        {
          default: false,
          description: l(
            'Initially select "Today" instead of no due date.',
            "默认选择“今天”，而不是不设置到期日。"
          ),
          name: "selectTodayAsDefault",
          title: l('Initially Select "Today"', "默认选择今天"),
          type: "checkbox"
        }
      ],
      runtime: {
        viewport: createReminderViewport
      },
      title: l("Create Reminder", "创建提醒")
    },
    {
      description: l(
        "Quickly add a reminder from the current launcher query.",
        "根据当前启动器输入快速添加提醒。"
      ),
      keywords: ["apple", "reminders", "quick add", "add", "capture"],
      mode: "no-view",
      name: "quick-add-reminder",
      runtime: {},
      title: l("Quick Add Reminder", "快速添加提醒")
    },
    {
      description: l("Show Apple Reminders in the menu bar.", "在菜单栏显示 Apple 提醒事项。"),
      keywords: ["apple", "reminders", "menu bar", "tray"],
      mode: "menu-bar",
      name: "menu-bar-reminders",
      preferences: [
        {
          data: [
            { title: l("Nothing", "不显示"), value: "nothing" },
            { title: l("Count", "数量"), value: "count" },
            { title: l("First Reminder", "第一条提醒"), value: "firstReminder" }
          ],
          default: "count",
          description: l(
            "Choose what is shown in the menu bar title.",
            "选择菜单栏标题显示的内容。"
          ),
          name: "titleType",
          title: l("Title", "标题"),
          type: "dropdown"
        },
        {
          data: [
            { title: l("Today", "今天"), value: "today" },
            { title: l("Upcoming", "即将到来"), value: "upcoming" },
            { title: l("All", "全部"), value: "all" }
          ],
          default: "today",
          description: l(
            "Choose which reminders appear in the menu bar.",
            "选择菜单栏里显示哪些提醒。"
          ),
          name: "view",
          title: l("View", "视图"),
          type: "dropdown"
        },
        {
          data: [
            { title: l("Today", "今天"), value: "today" },
            { title: l("Upcoming", "即将到来"), value: "upcoming" },
            { title: l("All", "全部"), value: "all" }
          ],
          default: "today",
          description: l(
            "Choose which reminder count is shown in the menu bar.",
            "选择菜单栏显示哪类提醒数量。"
          ),
          name: "countType",
          title: l("Count", "数量"),
          type: "dropdown"
        },
        {
          default: false,
          description: l(
            "Hide the menu bar count when there are no reminders in the selected view.",
            "所选视图没有提醒时隐藏菜单栏数量。"
          ),
          name: "hideMenuBarCountWhenEmpty",
          title: l("Hide Count When Empty", "为空时隐藏数量"),
          type: "checkbox"
        },
        {
          default: false,
          description: l(
            "Sort reminders in the menu bar by due date instead of creation date.",
            "菜单栏提醒按到期日而不是创建日期排序。"
          ),
          name: "sortMenuBarRemindersByDueDate",
          title: l("Sort by Due Date", "按到期日排序"),
          type: "checkbox"
        },
        {
          default: false,
          description: l(
            "Show the originating list name next to reminder titles in the menu bar.",
            "在菜单栏提醒标题旁显示所属列表名。"
          ),
          name: "displayListTitleForMenuBarReminders",
          title: l("Display List Name", "显示列表名"),
          type: "checkbox"
        },
        {
          default: "60",
          description: l(
            "How often the menu bar refreshes reminders, in seconds.",
            "菜单栏刷新提醒的间隔，单位为秒。"
          ),
          name: "refreshIntervalSeconds",
          title: l("Refresh Interval Seconds", "刷新间隔秒数"),
          type: "text"
        }
      ],
      runtime: {},
      title: l("Menu Bar Reminders", "菜单栏提醒")
    }
  ],
  description: l("Manage Apple Reminders inside Openwork.", "在 Openwork 中管理 Apple 提醒事项。"),
  name: APPLE_REMINDERS_EXTENSION_ID,
  rpcMethods: [
    "create-reminder",
    "delete-reminder",
    "get-data",
    "set-reminder-completed",
    "show-reminder"
  ],
  supportedPlatforms: ["darwin"],
  title: l("Apple Reminders", "提醒事项")
})
