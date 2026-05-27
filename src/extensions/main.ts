import {
  type NativeExtensionMainDefinition,
  validateNativeExtensionMainDefinition
} from "@shared/native-extensions"
import { appleRemindersMain } from "../../extensions/apple-reminders/main"
import { appleRemindersManifest } from "../../extensions/apple-reminders/manifest"
import { githubMain } from "../../extensions/github/main"
import { githubManifest } from "../../extensions/github/manifest"
import { notionMain } from "./notion/main"
import { notionManifest } from "./notion/manifest"
import { todoListMain } from "./todo-list/main"
import { todoListManifest } from "./todo-list/manifest"
import { translateMain } from "./translate/main"
import { translateManifest } from "./translate/manifest"

export const nativeExtensionMainDefinitions = new Map<string, NativeExtensionMainDefinition>([
  [appleRemindersManifest.name, appleRemindersMain],
  [githubManifest.name, githubMain],
  [notionManifest.name, notionMain],
  [todoListManifest.name, todoListMain],
  [translateManifest.name, translateMain]
])

validateNativeExtensionMainDefinition(appleRemindersManifest, appleRemindersMain)
validateNativeExtensionMainDefinition(githubManifest, githubMain)
validateNativeExtensionMainDefinition(notionManifest, notionMain)
validateNativeExtensionMainDefinition(todoListManifest, todoListMain)
validateNativeExtensionMainDefinition(translateManifest, translateMain)
