import {
  ExtensionRuntimeRequestError,
  throwExtensionRuntimeRequestError,
  type ExtensionRuntimeHostContextValue,
  type ExtensionRuntimeHostRequestInput
} from "./runtime-context"
import type { ExtensionHostResponse } from "../../shared/extension-runtime-protocol"

type CommandStorageRequestHost = (
  request: ExtensionRuntimeHostRequestInput
) => Promise<ExtensionHostResponse>

export function handleCommandStorageFailure(
  reportFatalError: ExtensionRuntimeHostContextValue["reportFatalError"],
  error: unknown
): boolean {
  if (error instanceof ExtensionRuntimeRequestError && error.code === "storage_legacy_unowned") {
    return true
  }

  reportFatalError(error)
  return false
}

export async function readCommandStorageValue(
  requestHost: CommandStorageRequestHost,
  key: string
): Promise<unknown> {
  const response = await requestHost({
    capability: "storage",
    method: "get",
    payload: {
      key,
      scope: "command"
    }
  })

  if (!response.ok) {
    throwExtensionRuntimeRequestError(response.error)
  }

  return response.result
}

export async function writeCommandStorageValue(
  requestHost: CommandStorageRequestHost,
  key: string,
  value: unknown
): Promise<void> {
  const response = await requestHost({
    capability: "storage",
    method: "set",
    payload: {
      key,
      scope: "command",
      value
    }
  })

  if (!response.ok) {
    throwExtensionRuntimeRequestError(response.error)
  }
}

export async function removeCommandStorageValue(
  requestHost: CommandStorageRequestHost,
  key: string
): Promise<void> {
  const response = await requestHost({
    capability: "storage",
    method: "remove",
    payload: {
      key,
      scope: "command"
    }
  })

  if (!response.ok) {
    throwExtensionRuntimeRequestError(response.error)
  }
}

export async function writeCommandStorageValueAndDiscardLegacy(
  requestHost: CommandStorageRequestHost,
  key: string,
  legacyKey: string | undefined,
  value: unknown
): Promise<void> {
  await writeCommandStorageValue(requestHost, key, value)
  if (legacyKey && legacyKey !== key) {
    await removeCommandStorageValue(requestHost, legacyKey)
  }
}
