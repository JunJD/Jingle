import type { ExtensionAiAskPayload } from "@shared/extension-runtime-protocol"
import { getActiveExtensionRuntimeSdk } from "./context"

export type RuntimeAiAskInput = ExtensionAiAskPayload

export const AI = {
  async ask(input: RuntimeAiAskInput): Promise<string> {
    const response = await getActiveExtensionRuntimeSdk().requestHost({
      capability: "ai",
      method: "ask",
      payload: input
    })

    if (!response.ok) {
      throw new Error(response.error.message)
    }

    return response.result as string
  }
}
