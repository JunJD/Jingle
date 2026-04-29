import { defineNativeExtensionRenderer } from "@shared/native-extensions"
import * as MenuBarRemindersModule from "./src/menu-bar-reminders"

export const appleRemindersRenderer = defineNativeExtensionRenderer({
  commands: [
    {
      commandModule: MenuBarRemindersModule,
      name: "menu-bar-reminders"
    }
  ]
})
