import { imageGenerationRuntime } from "../../extensions/image-generation/runtime"
import { todoListRuntime } from "./todo-list/runtime"
import { translateRuntime } from "./translate/runtime"

export const nativeExtensionRuntimePackages = [
  imageGenerationRuntime,
  todoListRuntime,
  translateRuntime
]
