import { appleRemindersRuntime } from "../../extensions/apple-reminders/runtime"
import { githubRuntime } from "../../extensions/github/runtime"
import { notionRuntime } from "../../extensions/notion/runtime"
import { todoListRuntime } from "./todo-list/runtime"
import { translateRuntime } from "./translate/runtime"

export const nativeExtensionRuntimePackages = [
  appleRemindersRuntime,
  githubRuntime,
  notionRuntime,
  todoListRuntime,
  translateRuntime
]
