import { defineNativeExtensionMain } from "../../shared/native-extensions"
import translateNativeExtensionService from "./main/service"

export const translateMain = defineNativeExtensionMain({
  service: translateNativeExtensionService
})
