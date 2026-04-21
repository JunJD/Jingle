import { defineNativeExtensionRenderer } from "@shared/native-extensions"
import * as IndexMeta from "./src/index.meta"
import * as IndexModule from "./src/index"

export const todoListRenderer = defineNativeExtensionRenderer({
  commands: [{ commandModule: IndexModule, metaModule: IndexMeta, name: "index" }]
})
