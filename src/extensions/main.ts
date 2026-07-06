import {
  type NativeExtensionMainDefinition,
  validateNativeExtensionMainDefinition
} from "@shared/native-extensions"
import { todoListMain } from "./todo-list/main"
import { todoListManifest } from "./todo-list/manifest"
import { translateMain } from "./translate/main"
import { translateManifest } from "./translate/manifest"

export const nativeExtensionMainDefinitions = new Map<string, NativeExtensionMainDefinition>([
  [todoListManifest.name, todoListMain],
  [translateManifest.name, translateMain]
])

validateNativeExtensionMainDefinition(todoListManifest, todoListMain)
validateNativeExtensionMainDefinition(translateManifest, translateMain)
