import { defineNativeExtensionRuntime } from "@jingle/extension-api"
import TodoList from "./src/index"

export const todoListRuntime = defineNativeExtensionRuntime({
  commands: {
    index: {
      Component: TodoList,
      mode: "view"
    }
  },
  extensionName: "todo-list"
})
