import githubExtension from "./github"
import todoListExtension from "./todo-list"
import translateExtension from "./translate"

export const nativeExtensions = [githubExtension, todoListExtension, translateExtension]
  .sort((left, right) => left.manifest.title.localeCompare(right.manifest.title))
