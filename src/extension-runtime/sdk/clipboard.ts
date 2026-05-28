import { getActiveExtensionRuntimeSdk } from "./context"
import type { RuntimeClipboardContent } from "./actions"

export const Clipboard = {
  async copy(content: RuntimeClipboardContent): Promise<void> {
    await writeClipboardText(content)
  },

  async readText(): Promise<string> {
    const response = await getActiveExtensionRuntimeSdk().requestHost({
      capability: "clipboard",
      method: "read-text"
    })

    if (!response.ok) {
      throw new Error(response.error.message)
    }

    return response.result as string
  }
}

export async function writeClipboardText(content: RuntimeClipboardContent): Promise<void> {
  const response = await getActiveExtensionRuntimeSdk().requestHost({
    capability: "clipboard",
    method: "write-text",
    payload: {
      text: normalizeClipboardContent(content)
    }
  })

  if (!response.ok) {
    throw new Error(response.error.message)
  }
}

export async function getSelectedText(): Promise<string> {
  const fallbackText = getActiveExtensionRuntimeSdk().launchProps?.fallbackText
  if (fallbackText !== undefined) {
    return fallbackText
  }

  const response = await getActiveExtensionRuntimeSdk().requestHost({
    capability: "clipboard",
    method: "read-selected-text"
  })

  if (!response.ok) {
    throw new Error(response.error.message)
  }

  return response.result as string
}

function normalizeClipboardContent(content: RuntimeClipboardContent): string {
  return typeof content === "string" ? content : (content.text ?? content.html ?? "")
}
