import type { ExtensionAiAskPayload } from "@shared/extension-runtime-protocol"

export type ExtensionAiModelTarget = { kind: "default" } | { kind: "fast" }

export function parseExtensionAiModelTarget(
  input: Pick<ExtensionAiAskPayload, "modelPreference">
): ExtensionAiModelTarget {
  return input.modelPreference === "fast" ? { kind: "fast" } : { kind: "default" }
}
