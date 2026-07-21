import {
  normalizeExtensionAiAskPayload,
  type ExtensionAiAskPayload
} from "../../shared/extension-runtime-protocol"
import { getActiveExtensionRuntimeSdk, throwExtensionRuntimeRequestError } from "./runtime-context"

export type RuntimeAiAskInput = Omit<ExtensionAiAskPayload, "modelPreference"> & {
  modelPreference: "fast"
}

export const AI = {
  async ask(input: RuntimeAiAskInput | string): Promise<string> {
    const payload = normalizeExtensionAiAskPayload(
      typeof input === "string" ? { modelPreference: "default", prompt: input } : input
    )
    const response = await getActiveExtensionRuntimeSdk().requestHost({
      capability: "ai",
      method: "ask",
      payload
    })

    if (!response.ok) {
      throwExtensionRuntimeRequestError(response.error)
    }

    return response.result as string
  }
}
