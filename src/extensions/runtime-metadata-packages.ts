import { appleRemindersRuntimeMetadata } from "../../extensions/apple-reminders/runtime-metadata"
import { figmaFilesRuntimeMetadata } from "../../extensions/figma-files/runtime-metadata"
import { githubRuntimeMetadata } from "../../extensions/github/runtime-metadata"
import { notionRuntimeMetadata } from "../../extensions/notion/runtime-metadata"
import { todoListRuntimeMetadata } from "./todo-list/runtime-metadata"
import { translateRuntimeMetadata } from "./translate/runtime-metadata"

export const nativeExtensionRuntimeMetadataPackages = [
  appleRemindersRuntimeMetadata,
  figmaFilesRuntimeMetadata,
  githubRuntimeMetadata,
  notionRuntimeMetadata,
  todoListRuntimeMetadata,
  translateRuntimeMetadata
]
