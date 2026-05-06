import { getActiveExtensionRuntimeSdk } from "./context"

export async function writeClipboardText(text: string): Promise<void> {
  const response = await getActiveExtensionRuntimeSdk().requestHost({
    capability: "clipboard",
    method: "write-text",
    payload: {
      text
    }
  })

  if (!response.ok) {
    throw new Error(response.error.message)
  }
}
