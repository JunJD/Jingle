import { defineNativeExtensionRenderer } from "@shared/native-extensions"
import * as MenuBarRemindersModule from "./src/menu-bar-reminders"
import * as QuickAddReminderModule from "./src/quick-add-reminder"

export const appleRemindersRenderer = defineNativeExtensionRenderer({
  commands: [
    {
      commandModule: MenuBarRemindersModule,
      name: "menu-bar-reminders"
    },
    {
      commandModule: QuickAddReminderModule,
      name: "quick-add-reminder"
    }
  ]
})
