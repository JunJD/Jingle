import { githubManifest } from "./github/manifest"
import { todoListManifest } from "./todo-list/manifest"
import { translateManifest } from "./translate/manifest"

export const nativeExtensionManifests = [githubManifest, todoListManifest, translateManifest].sort(
  (left, right) => left.title.localeCompare(right.title)
)
