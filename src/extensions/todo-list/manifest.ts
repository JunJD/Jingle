import { defineNativeExtensionManifest } from "@shared/native-extensions"
import { viewport as todoListViewport } from "./src/index.meta"

export const todoListManifest = defineNativeExtensionManifest({
  capabilities: ["navigation", "surface"],
  icon: "assets/icon.svg",
  iconName: "todo",
  runtimeCapabilities: ["preferences", "shell", "storage"],
  commands: [
    {
      description: "Capture and organize lightweight tasks.",
      keywords: ["todo", "todos", "task", "tasks", "待办", "待办事项"],
      mode: "view",
      name: "index",
      preferences: [
        {
          data: [
            { title: "Newest first", value: "creation_date_descending" },
            { title: "Oldest first", value: "creation_date_ascending" },
            { title: "Title A-Z", value: "title_ascending" },
            { title: "Title Z-A", value: "title_descending" }
          ],
          default: "creation_date_descending",
          description: "Order todos inside each group.",
          name: "sortOrder",
          title: "Sort order",
          type: "dropdown"
        },
        {
          default: true,
          description: "Keep completed todos visible in the list.",
          name: "showCompleted",
          title: "Show completed",
          type: "checkbox"
        }
      ],
      runtime: {
        viewport: todoListViewport
      },
      title: "Todo List"
    }
  ],
  description: "Manage todos with a native Openwork list extension.",
  name: "todo-list",
  title: "Todo List"
})
