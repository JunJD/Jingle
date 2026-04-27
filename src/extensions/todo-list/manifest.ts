import { defineNativeExtensionManifest } from "@shared/native-extensions"

export const todoListManifest = defineNativeExtensionManifest({
  capabilities: ["navigation", "surface"],
  iconName: "todo",
  commands: [
    {
      description: "Create and organize todo items.",
      iconName: "todo",
      keywords: ["todo", "todos", "task", "tasks", "待办", "待办事项"],
      mode: "view",
      name: "index",
      preferences: [
        {
          data: [
            { title: "Creation Date (newest first)", value: "creation_date_descending" },
            { title: "Creation Date (oldest first)", value: "creation_date_ascending" },
            { title: "Title (A-Z)", value: "title_ascending" },
            { title: "Title (Z-A)", value: "title_descending" }
          ],
          default: "creation_date_descending",
          description: "Choose how todo items are ordered inside each section.",
          name: "sortOrder",
          title: "Task Sorting",
          type: "dropdown"
        },
        {
          default: true,
          description: "Whether completed tasks stay visible in the list.",
          name: "showCompleted",
          title: "Show Completed Tasks",
          type: "checkbox"
        }
      ],
      title: "Todo List"
    }
  ],
  description: "Manage todos with a native Openwork list extension.",
  name: "todo-list",
  title: "Todo List"
})
