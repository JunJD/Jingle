import { appleRemindersRuntimeMetadata } from "../../extensions/apple-reminders/runtime-metadata"
import { githubRuntimeMetadata } from "../../extensions/github/runtime-metadata"
import { notionRuntimeMetadata } from "../../extensions/notion/runtime-metadata"
import { todoListRuntimeMetadata } from "./todo-list/runtime-metadata"
import { translateRuntimeMetadata } from "./translate/runtime-metadata"

export const nativeExtensionRuntimeMetadataPackages = [
  appleRemindersRuntimeMetadata,
  githubRuntimeMetadata,
  notionRuntimeMetadata,
  todoListRuntimeMetadata,
  translateRuntimeMetadata
]
