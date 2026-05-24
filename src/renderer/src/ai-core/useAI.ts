import { useCallback } from "react"
import { useNativeExtensionHostOptional } from "@extension-host/sdk"
import { listRegisteredAiTools, registerAiTools, type AiToolDefinition } from "./tool-registry"

export interface UseAIResult {
  listTools: () => ReturnType<typeof listRegisteredAiTools>
  ownerId: string
  registerTools: (tools: readonly AiToolDefinition[]) => () => void
}

export function useAI(ownerId?: string): UseAIResult {
  const host = useNativeExtensionHostOptional()
  const resolvedOwnerId = ownerId ?? host?.extensionName ?? "ai-core"

  const registerToolsForOwner = useCallback(
    (tools: readonly AiToolDefinition[]) => registerAiTools(resolvedOwnerId, tools),
    [resolvedOwnerId]
  )

  return {
    listTools: listRegisteredAiTools,
    ownerId: resolvedOwnerId,
    registerTools: registerToolsForOwner
  }
}
