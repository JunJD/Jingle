import { defineNativeExtensionRenderer } from "@shared/native-extensions"
import * as CreateReminderMeta from "./src/create-reminder.meta"
import * as CreateReminderModule from "./src/create-reminder"
import * as MenuBarRemindersModule from "./src/menu-bar-reminders"
import * as MyRemindersMeta from "./src/my-reminders.meta"
import * as MyRemindersModule from "./src/my-reminders"
import * as QuickAddReminderModule from "./src/quick-add-reminder"

export const appleRemindersRenderer = defineNativeExtensionRenderer({
  commands: [
    {
      commandModule: CreateReminderModule,
      metaModule: CreateReminderMeta,
      name: "create-reminder"
    },
    {
      commandModule: MenuBarRemindersModule,
      name: "menu-bar-reminders"
    },
    {
      commandModule: MyRemindersModule,
      metaModule: MyRemindersMeta,
      name: "my-reminders"
    },
    {
      commandModule: QuickAddReminderModule,
      name: "quick-add-reminder"
    }
  ]
})
