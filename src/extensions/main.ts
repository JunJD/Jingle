import {
  type NativeExtensionMainDefinition,
  validateNativeExtensionMainDefinition
} from "@shared/native-extensions"
import { imageGenerationMain } from "../../extensions/image-generation/main"
import { imageGenerationManifest } from "../../extensions/image-generation/manifest"
import { todoListMain } from "./todo-list/main"
import { todoListManifest } from "./todo-list/manifest"
import { translateMain } from "./translate/main"
import { translateManifest } from "./translate/manifest"

export const nativeExtensionMainDefinitions = new Map<string, NativeExtensionMainDefinition>([
  [imageGenerationManifest.name, imageGenerationMain],
  [todoListManifest.name, todoListMain],
  [translateManifest.name, translateMain]
])

validateNativeExtensionMainDefinition(imageGenerationManifest, imageGenerationMain)
validateNativeExtensionMainDefinition(todoListManifest, todoListMain)
validateNativeExtensionMainDefinition(translateManifest, translateMain)
