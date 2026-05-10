import { appleRemindersRuntimeMetadata } from "./apple-reminders/runtime-metadata"
import { githubRuntimeMetadata } from "./github/runtime-metadata"
import { todoListRuntimeMetadata } from "./todo-list/runtime-metadata"
import { translateRuntimeMetadata } from "./translate/runtime-metadata"

export const nativeExtensionRuntimeMetadataPackages = [
  appleRemindersRuntimeMetadata,
  githubRuntimeMetadata,
  todoListRuntimeMetadata,
  translateRuntimeMetadata
]
