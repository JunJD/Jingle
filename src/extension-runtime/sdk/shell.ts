import { getActiveExtensionRuntimeSdk } from "./context"

export async function openExternal(url: string): Promise<void> {
  const response = await getActiveExtensionRuntimeSdk().requestHost({
    capability: "shell",
    method: "open-external",
    payload: {
      url
    }
  })

  if (!response.ok) {
    throw new Error(response.error.message)
  }
}
