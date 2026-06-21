import type { NativeExtensionResolvedConnection } from "@shared/native-extensions"
import { resolveNativeExtensionExecutionContext } from "./execution-context"

export function resolveNativeExtensionConnection(input: {
  extensionName: string
  platform?: string
}): NativeExtensionResolvedConnection {
  return resolveNativeExtensionExecutionContext(input).connection
}
