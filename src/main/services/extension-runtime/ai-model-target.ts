import type { ExtensionAiAskPayload } from "@shared/extension-runtime-protocol"

export type ExtensionAiModelTarget =
  | { kind: "default" }
  | { kind: "explicit"; modelId: string }
  | { kind: "fast" }

export function parseExtensionAiModelTarget(
  input: Pick<ExtensionAiAskPayload, "modelId" | "modelPreference">
): ExtensionAiModelTarget {
  if (input.modelId !== undefined) {
    if (input.modelPreference !== undefined) {
      throw new Error("AI request cannot specify both modelId and modelPreference.")
    }
    const modelId = input.modelId.trim()
    if (!modelId) {
      throw new Error("AI request modelId must be a non-empty string.")
    }
    return { kind: "explicit", modelId }
  }
  return input.modelPreference === "fast" ? { kind: "fast" } : { kind: "default" }
}
