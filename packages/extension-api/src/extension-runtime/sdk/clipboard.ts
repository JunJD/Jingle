import { getActiveExtensionRuntimeSdk, throwExtensionRuntimeRequestError } from "./runtime-context"
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
      throwExtensionRuntimeRequestError(response.error)
    }

    return response.result as string
  }
}

export async function writeClipboardText(content: RuntimeClipboardContent): Promise<void> {
  const normalizedContent = normalizeClipboardContent(content)
  const response = await getActiveExtensionRuntimeSdk().requestHost({
    capability: "clipboard",
    method: "write-text",
    payload: normalizedContent
  })

  if (!response.ok) {
    throwExtensionRuntimeRequestError(response.error)
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
    throwExtensionRuntimeRequestError(response.error)
  }

  return response.result as string
}

function normalizeClipboardContent(content: RuntimeClipboardContent): { html?: string; text: string } {
  if (typeof content === "string") {
    return { text: content }
  }

  return {
    ...(content.html !== undefined ? { html: content.html } : {}),
    text: content.text ?? content.html ?? ""
  }
}
