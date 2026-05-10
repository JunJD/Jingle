import { appleRemindersRuntime } from "./apple-reminders/runtime"
import { githubRuntime } from "./github/runtime"
import { todoListRuntime } from "./todo-list/runtime"
import { translateRuntime } from "./translate/runtime"

export const nativeExtensionRuntimePackages = [
  appleRemindersRuntime,
  githubRuntime,
  todoListRuntime,
  translateRuntime
]
