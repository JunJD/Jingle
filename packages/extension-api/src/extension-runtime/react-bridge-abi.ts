import type * as React from "react"
import type * as ReactJsxDevRuntime from "react/jsx-dev-runtime"
import type * as ReactJsxRuntime from "react/jsx-runtime"

export const JINGLE_EXTENSION_RUNTIME_REACT_BRIDGE_VERSION = 1 as const
export const JINGLE_EXTENSION_RUNTIME_REACT_BRIDGE_GLOBAL_KEY = Symbol.for(
  "jingle.extensionRuntime.reactBridge"
)

export interface JingleExtensionRuntimeReactBridge {
  React: typeof React
  jsxDevRuntime: typeof ReactJsxDevRuntime
  jsxRuntime: typeof ReactJsxRuntime
  version: typeof JINGLE_EXTENSION_RUNTIME_REACT_BRIDGE_VERSION
}

export function installExtensionRuntimeReactBridge(
  bridge: Omit<JingleExtensionRuntimeReactBridge, "version">
): void {
  const runtimeGlobal = globalThis as Record<symbol, unknown>
  runtimeGlobal[JINGLE_EXTENSION_RUNTIME_REACT_BRIDGE_GLOBAL_KEY] = {
    ...bridge,
    version: JINGLE_EXTENSION_RUNTIME_REACT_BRIDGE_VERSION
  } satisfies JingleExtensionRuntimeReactBridge
}

export function getExtensionRuntimeReactBridge(): JingleExtensionRuntimeReactBridge {
  const runtimeGlobal = globalThis as Record<symbol, unknown>
  const bridge = runtimeGlobal[JINGLE_EXTENSION_RUNTIME_REACT_BRIDGE_GLOBAL_KEY]

  if (!bridge || typeof bridge !== "object") {
    throw new Error("Jingle extension runtime React bridge is not installed.")
  }

  const candidate = bridge as Partial<JingleExtensionRuntimeReactBridge>
  if (candidate.version !== JINGLE_EXTENSION_RUNTIME_REACT_BRIDGE_VERSION) {
    throw new Error(
      `Jingle extension runtime React bridge version ${String(candidate.version)} is not supported.`
    )
  }

  if (!candidate.React || !candidate.jsxRuntime || !candidate.jsxDevRuntime) {
    throw new Error("Jingle extension runtime React bridge is incomplete.")
  }

  return candidate as JingleExtensionRuntimeReactBridge
}
