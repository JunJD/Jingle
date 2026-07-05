import type { ComponentType } from "react"
import { defineNativeExtensionRuntime } from "@jingle/extension-api"
import NotionAddTextToPageCommandSource from "./src/add-text-to-page"
import NotionCreateDatabasePageCommandSource from "./src/create-database-page"
import NotionQuickCaptureCommandSource from "./src/quick-capture"
import NotionSearchPageCommandSource from "./src/search-page"

const NotionAddTextToPageCommand =
  NotionAddTextToPageCommandSource as ComponentType<Record<string, unknown>>
const NotionCreateDatabasePageCommand =
  NotionCreateDatabasePageCommandSource as ComponentType<Record<string, unknown>>
const NotionQuickCaptureCommand =
  NotionQuickCaptureCommandSource as ComponentType<Record<string, unknown>>
const NotionSearchPageCommand = NotionSearchPageCommandSource as ComponentType<Record<string, unknown>>

export const notionRuntime = defineNativeExtensionRuntime({
  commands: {
    "add-text-to-page": {
      Component: NotionAddTextToPageCommand,
      mode: "view"
    },
    "create-database-page": {
      Component: NotionCreateDatabasePageCommand,
      mode: "view"
    },
    "quick-capture": {
      Component: NotionQuickCaptureCommand,
      mode: "view"
    },
    "search-page": {
      Component: NotionSearchPageCommand,
      mode: "view"
    }
  },
  extensionName: "notion"
})
