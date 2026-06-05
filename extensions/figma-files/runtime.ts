import type { ComponentType } from "react"
import { defineNativeExtensionRuntime } from "@openwork/extension-api"
import FigmaFilesIndexCommandSource from "./src/index"
import FigmaFilesMenuBarCommandSource from "./src/menu-bar"

const FigmaFilesIndexCommand = FigmaFilesIndexCommandSource as ComponentType<Record<string, unknown>>
const FigmaFilesMenuBarCommand = FigmaFilesMenuBarCommandSource as ComponentType<Record<string, unknown>>

// Generated migration preview. Source files are import-rewritten but may still need SDK facade work before this runtime compiles.
export const figmaFilesRuntime = defineNativeExtensionRuntime({
  commands: {
    "index": {
      Component: FigmaFilesIndexCommand,
      mode: "view"
    },
    "menu-bar": {
      Component: FigmaFilesMenuBarCommand,
      mode: "menu-bar"
    }
  },
  extensionName: "figma-files"
})
