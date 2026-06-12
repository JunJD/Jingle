import { defineNativeExtensionManifest } from "@shared/native-extensions"
import { defineLocalizedText as l } from "@shared/i18n"
import { viewport as todoListViewport } from "./src/index.meta"

export const todoListManifest = defineNativeExtensionManifest({
  capabilities: ["navigation", "surface"],
  connection: {
    auth: {
      type: "none"
    },
    id: "default",
    provider: "todo-list",
    title: l("Todo List", "待办列表")
  },
  icon: "assets/icon.svg",
  iconName: "todo",
  runtimeCapabilities: ["preferences", "shell", "storage"],
  commands: [
    {
      description: l("Capture and organize lightweight tasks.", "记录并整理轻量任务。"),
      keywords: ["todo", "todos", "task", "tasks", "待办", "待办事项"],
      mode: "view",
      name: "index",
      preferences: [
        {
          data: [
            { title: l("Newest first", "最新优先"), value: "creation_date_descending" },
            { title: l("Oldest first", "最早优先"), value: "creation_date_ascending" },
            { title: l("Title A-Z", "标题 A-Z"), value: "title_ascending" },
            { title: l("Title Z-A", "标题 Z-A"), value: "title_descending" }
          ],
          default: "creation_date_descending",
          description: l("Order todos inside each group.", "设置每个分组里的待办排序。"),
          name: "sortOrder",
          title: l("Sort order", "排序方式"),
          type: "dropdown"
        },
        {
          default: true,
          description: l("Keep completed todos visible in the list.", "在列表中保留已完成的待办。"),
          name: "showCompleted",
          title: l("Show completed", "显示已完成"),
          type: "checkbox"
        }
      ],
      runtime: {
        viewport: todoListViewport
      },
      title: l("Todo List", "待办列表")
    }
  ],
  description: l(
    "Manage todos with a native Jingle list extension.",
    "用原生 Jingle 列表扩展管理待办。"
  ),
  name: "todo-list",
  title: l("Todo List", "待办列表")
})
