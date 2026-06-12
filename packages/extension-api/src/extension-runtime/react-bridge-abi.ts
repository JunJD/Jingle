import type * as React from "react"
import type * as ReactJsxDevRuntime from "react/jsx-dev-runtime"
import type * as ReactJsxRuntime from "react/jsx-runtime"

export const OPENWORK_EXTENSION_RUNTIME_REACT_BRIDGE_VERSION = 1 as const
export const OPENWORK_EXTENSION_RUNTIME_REACT_BRIDGE_GLOBAL_KEY = Symbol.for(
  "openwork.extensionRuntime.reactBridge"
)

export interface OpenworkExtensionRuntimeReactBridge {
  React: typeof React
  jsxDevRuntime: typeof ReactJsxDevRuntime
  jsxRuntime: typeof ReactJsxRuntime
  version: typeof OPENWORK_EXTENSION_RUNTIME_REACT_BRIDGE_VERSION
}

export function installExtensionRuntimeReactBridge(
  bridge: Omit<OpenworkExtensionRuntimeReactBridge, "version">
): void {
  const runtimeGlobal = globalThis as Record<symbol, unknown>
  runtimeGlobal[OPENWORK_EXTENSION_RUNTIME_REACT_BRIDGE_GLOBAL_KEY] = {
    ...bridge,
    version: OPENWORK_EXTENSION_RUNTIME_REACT_BRIDGE_VERSION
  } satisfies OpenworkExtensionRuntimeReactBridge
}

export function getExtensionRuntimeReactBridge(): OpenworkExtensionRuntimeReactBridge {
  const runtimeGlobal = globalThis as Record<symbol, unknown>
  const bridge = runtimeGlobal[OPENWORK_EXTENSION_RUNTIME_REACT_BRIDGE_GLOBAL_KEY]

  if (!bridge || typeof bridge !== "object") {
    throw new Error("Openwork extension runtime React bridge is not installed.")
  }

  const candidate = bridge as Partial<OpenworkExtensionRuntimeReactBridge>
  if (candidate.version !== OPENWORK_EXTENSION_RUNTIME_REACT_BRIDGE_VERSION) {
    throw new Error(
      `Openwork extension runtime React bridge version ${String(candidate.version)} is not supported.`
    )
  }

  if (!candidate.React || !candidate.jsxRuntime || !candidate.jsxDevRuntime) {
    throw new Error("Openwork extension runtime React bridge is incomplete.")
  }

  return candidate as OpenworkExtensionRuntimeReactBridge
}
