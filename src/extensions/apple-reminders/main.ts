import { defineNativeExtensionMain } from "../../shared/native-extensions"
import appleRemindersNativeExtensionService from "./main/service"

export const appleRemindersMain = defineNativeExtensionMain({
  service: appleRemindersNativeExtensionService
})
