import {
  type NativeExtensionMainDefinition,
  validateNativeExtensionMainDefinition
} from "../shared/native-extensions"
import { githubMain } from "./github/main"
import { githubManifest } from "./github/manifest"
import { todoListMain } from "./todo-list/main"
import { todoListManifest } from "./todo-list/manifest"
import { translateMain } from "./translate/main"
import { translateManifest } from "./translate/manifest"

export const nativeExtensionMainDefinitions = new Map<string, NativeExtensionMainDefinition>([
  [githubManifest.name, githubMain],
  [todoListManifest.name, todoListMain],
  [translateManifest.name, translateMain]
])

validateNativeExtensionMainDefinition(githubManifest, githubMain)
validateNativeExtensionMainDefinition(todoListManifest, todoListMain)
validateNativeExtensionMainDefinition(translateManifest, translateMain)
