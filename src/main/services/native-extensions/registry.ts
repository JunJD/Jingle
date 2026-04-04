import translateNativeExtensionService from "@extensions/translate/main/service"
import type { NativeExtensionService } from "./sdk"

export const nativeExtensionServiceRegistry = new Map<string, NativeExtensionService>([
  ["translate", translateNativeExtensionService]
])
