import type { ExtensionAiAskPayload } from "../../shared/extension-runtime-protocol"
import { getActiveExtensionRuntimeSdk, throwExtensionRuntimeRequestError } from "./runtime-context"

export type RuntimeAiAskInput = ExtensionAiAskPayload

export const AI = {
  async ask(input: RuntimeAiAskInput | string): Promise<string> {
    const response = await getActiveExtensionRuntimeSdk().requestHost({
      capability: "ai",
      method: "ask",
      payload: typeof input === "string" ? { prompt: input } : input
    })

    if (!response.ok) {
      throwExtensionRuntimeRequestError(response.error)
    }

    return response.result as string
  }
}
