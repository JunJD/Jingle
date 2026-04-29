import {
  type NativeExtensionRendererDefinition,
  validateNativeExtensionRendererDefinition
} from "@shared/native-extensions"
import { appleRemindersManifest } from "./apple-reminders/manifest"
import { appleRemindersRenderer } from "./apple-reminders/renderer"
import { githubManifest } from "./github/manifest"
import { githubRenderer } from "./github/renderer"
import { todoListManifest } from "./todo-list/manifest"
import { todoListRenderer } from "./todo-list/renderer"
import { translateManifest } from "./translate/manifest"
import { translateRenderer } from "./translate/renderer"
import { nativeExtensionRuntimeBackedCommands } from "./runtime-backed"

export const nativeExtensionRendererDefinitions = new Map<
  string,
  NativeExtensionRendererDefinition
>([
  [appleRemindersManifest.name, appleRemindersRenderer],
  [githubManifest.name, githubRenderer],
  [todoListManifest.name, todoListRenderer],
  [translateManifest.name, translateRenderer]
])

validateNativeExtensionRendererDefinitionForRuntimeBackedCommands(
  appleRemindersManifest,
  appleRemindersRenderer
)
validateNativeExtensionRendererDefinitionForRuntimeBackedCommands(githubManifest, githubRenderer)
validateNativeExtensionRendererDefinitionForRuntimeBackedCommands(
  todoListManifest,
  todoListRenderer
)
validateNativeExtensionRendererDefinitionForRuntimeBackedCommands(
  translateManifest,
  translateRenderer
)

function validateNativeExtensionRendererDefinitionForRuntimeBackedCommands(
  manifest: Parameters<typeof validateNativeExtensionRendererDefinition>[0],
  renderer: Parameters<typeof validateNativeExtensionRendererDefinition>[1]
): void {
  validateNativeExtensionRendererDefinition(manifest, renderer, {
    runtimeBackedCommandNames: nativeExtensionRuntimeBackedCommands
      .filter((command) => command.extensionName === manifest.name)
      .map((command) => command.commandName)
  })
}
