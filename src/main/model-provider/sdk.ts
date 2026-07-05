import {
  createProviderChatModelFromAdapter,
  type ChatModelInstance,
  type ChatModelOptions
} from "./adapters"
import type { ResolvedModelRuntimeConfig } from "./types"

export type { ChatModelInstance }

export function createProviderChatModel(
  runtimeConfig: ResolvedModelRuntimeConfig,
  options: ChatModelOptions = {}
): ChatModelInstance {
  return createProviderChatModelFromAdapter(runtimeConfig, options)
}
