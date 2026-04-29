import { defineNativeExtensionRenderer } from "@shared/native-extensions"
import * as UnreadNotificationsModule from "./src/unread-notifications"

export const githubRenderer = defineNativeExtensionRenderer({
  commands: [{ commandModule: UnreadNotificationsModule, name: "unread-notifications" }]
})
