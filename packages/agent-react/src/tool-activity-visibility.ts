export interface JingleToolActivityVisibilityInput {
  hasExtensionPresentation: boolean
  isTodoListTool: boolean
  name: string
}

export function shouldProjectJingleToolActivity(input: JingleToolActivityVisibilityInput): boolean {
  if (input.name === "loadExtension") {
    return false
  }

  if (input.isTodoListTool) {
    return false
  }

  if (input.name === "callExtension") {
    return input.hasExtensionPresentation
  }

  return true
}
