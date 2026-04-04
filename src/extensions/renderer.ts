import {
  type NativeExtensionRendererDefinition,
  validateNativeExtensionRendererDefinition
} from "../shared/native-extensions"
import { githubManifest } from "./github/manifest"
import { githubRenderer } from "./github/renderer"
import { todoListManifest } from "./todo-list/manifest"
import { todoListRenderer } from "./todo-list/renderer"
import { translateManifest } from "./translate/manifest"
import { translateRenderer } from "./translate/renderer"

export const nativeExtensionRendererDefinitions = new Map<
  string,
  NativeExtensionRendererDefinition
>([
  [githubManifest.name, githubRenderer],
  [todoListManifest.name, todoListRenderer],
  [translateManifest.name, translateRenderer]
])

validateNativeExtensionRendererDefinition(githubManifest, githubRenderer)
validateNativeExtensionRendererDefinition(todoListManifest, todoListRenderer)
validateNativeExtensionRendererDefinition(translateManifest, translateRenderer)
