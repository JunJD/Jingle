import type { ExtensionAiAskPayload } from "../../shared/extension-runtime-protocol"
import { getActiveExtensionRuntimeSdk } from "./context"

export type RuntimeAiAskInput = ExtensionAiAskPayload

export const AI = {
  async ask(input: RuntimeAiAskInput | string): Promise<string> {
    const response = await getActiveExtensionRuntimeSdk().requestHost({
      capability: "ai",
      method: "ask",
      payload: typeof input === "string" ? { prompt: input } : input
    })

    if (!response.ok) {
      throw new Error(response.error.message)
    }

    return response.result as string
  }
}
