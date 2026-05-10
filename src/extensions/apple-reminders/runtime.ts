import { defineNativeExtensionRuntime } from "../runtime-api"
import AppleRemindersCreateReminder from "./src/create-reminder"
import AppleRemindersMenuBar from "./src/menu-bar-reminders"
import AppleRemindersMyReminders from "./src/my-reminders"
import AppleRemindersQuickAddReminder from "./src/quick-add-reminder"

export const appleRemindersRuntime = defineNativeExtensionRuntime({
  commands: {
    "create-reminder": {
      Component: AppleRemindersCreateReminder,
      mode: "view"
    },
    "menu-bar-reminders": {
      Component: AppleRemindersMenuBar,
      mode: "menu-bar"
    },
    "my-reminders": {
      Component: AppleRemindersMyReminders,
      mode: "view"
    },
    "quick-add-reminder": {
      mode: "no-view",
      run: AppleRemindersQuickAddReminder
    }
  },
  extensionName: "apple-reminders"
})
