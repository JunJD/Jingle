import * as React from "react"
import * as ReactJsxDevRuntime from "react/jsx-dev-runtime"
import * as ReactJsxRuntime from "react/jsx-runtime"
import type {
  ExtensionHostRequest,
  ExtensionHostResponse,
  ExtensionHostToRuntimeMessage,
  ExtensionRuntimeError,
  ExtensionRuntimeEvent,
  ExtensionRuntimeUtilityExecutionLease,
  ExtensionRuntimeToHostMessage
} from "@shared/extension-runtime-protocol"
import { loadNativeExtensionRuntimeCommand } from "./runtime-package-loader"
import {
  createFileExtensionRuntimeCacheBackend,
  EXTENSION_RUNTIME_CACHE_DIR_ENV
} from "./cache-backend"
import { createExtensionRuntimeRenderer, type ExtensionRuntimeRenderer } from "./reconciler/render"
import {
  createExtensionRuntimeLaunchProps,
  createExtensionRuntimeNavigation,
  ExtensionRuntimeNavigationProvider,
  installExtensionRuntimeReactBridge,
  installExtensionRuntimeCacheBackend,
  normalizeExtensionRuntimeNavigationHostRequest,
  runWithExtensionRuntimeSdk,
  sendExtensionRuntimeHostRequest,
  type ExtensionRuntimeHostRequestInput
} from "@jingle/extension-api/host-runtime"

let activeRenderer: ExtensionRuntimeRenderer | null = null
const pendingHostResponses = new Map<string, (response: ExtensionHostResponse) => void>()
let hostRequestIndex = 0

const parentPort = getParentPort()
installRuntimeReactBridge()
installRuntimeCacheBackend()

parentPort.on("message", (event) => {
  const message = event.data as ExtensionHostToRuntimeMessage

  switch (message.type) {
    case "start":
      void startRuntime(message.sessionId, message.lease)
      return
    case "stop":
      process.exit(0)
      return
    case "event":
      void handleRuntimeEvent(message.sessionId, message.event)
      return
    case "host-response":
      pendingHostResponses.get(message.response.id)?.(message.response)
      pendingHostResponses.delete(message.response.id)
      return
  }
})

async function handleRuntimeEvent(
  sessionId: string,
  runtimeEvent: ExtensionRuntimeEvent
): Promise<void> {
  try {
    const handled = (await activeRenderer?.dispatchEvent(runtimeEvent)) ?? false
    postRuntimeEventAck(sessionId, runtimeEvent, handled)
  } catch (error) {
    const runtimeError = toRuntimeError("runtime_error", error)
    postRuntimeEventAck(sessionId, runtimeEvent, false, runtimeError)
    postRuntimeError(sessionId, error)
  }
}

function postRuntimeEventAck(
  sessionId: string,
  runtimeEvent: ExtensionRuntimeEvent,
  ok: boolean,
  error?: ExtensionRuntimeError
): void {
  if (runtimeEvent.type !== "form.field.change") {
    return
  }

  postToHost({
    ack: {
      changeId: runtimeEvent.changeId,
      error,
      eventType: runtimeEvent.type,
      fieldId: runtimeEvent.fieldId,
      ok
    },
    sessionId,
    type: "event-ack"
  })
}

function postToHost(message: ExtensionRuntimeToHostMessage): void {
  parentPort.postMessage(message)
}

async function startRuntime(
  sessionId: string,
  receivedLease: ExtensionRuntimeUtilityExecutionLease
): Promise<void> {
  try {
    const lease = deepFreeze(structuredClone(receivedLease))
    const { context, runtime: runtimeRef } = lease
    const command = await loadNativeExtensionRuntimeCommand(runtimeRef, context)

    if (command.mode !== context.mode) {
      throw new Error(
        `Extension runtime command "${context.extensionName}:${context.commandName}" is registered for "${command.mode}" but launched as "${context.mode}".`
      )
    }

    const requestHostWithId = (request: ExtensionRuntimeHostRequestInput) =>
      sendExtensionRuntimeHostRequest(request, {
        createRequestId: () => `runtime-host-request-${hostRequestIndex++}`,
        send: (transportRequest) => requestHost(sessionId, transportRequest)
      })
    const resolvedContext = context

    if (command.mode === "no-view") {
      const navigation = createExtensionRuntimeNavigation({
        requestHost: requestHostWithId
      })
      void runWithExtensionRuntimeSdk(
        {
          ...resolvedContext,
          navigation,
          requestHost: requestHostWithId
        },
        () =>
          command.run({
            ...resolvedContext,
            navigation
          })
      )
        .then(() => {
          postToHost({
            sessionId,
            type: "ready"
          })
        })
        .catch((error) => {
          postRuntimeError(sessionId, error)
        })
      return
    }

    const renderer = createExtensionRuntimeRenderer(
      {
        commandName: context.commandName,
        extensionName: context.extensionName
      },
      {
        onHostRequest: (request) => requestHost(sessionId, request),
        onSnapshot: (surface) => {
          postToHost({
            sessionId,
            surface,
            type: "surface"
          })
        }
      }
    )
    activeRenderer = renderer
    renderer.render(
      React.createElement(
        ExtensionRuntimeNavigationProvider,
        {
          value: {
            ...resolvedContext,
            requestHost: requestHostWithId,
            registerToastAction: renderer.registerToastAction
          }
        },
        React.createElement(command.Component, createExtensionRuntimeLaunchProps(resolvedContext))
      )
    )
    void renderer
      .flushSnapshots()
      .then(() => {
        postToHost({
          sessionId,
          type: "ready"
        })
      })
      .catch((error) => {
        postRuntimeError(sessionId, error)
      })
  } catch (error) {
    postRuntimeError(sessionId, error)
  }
}

function installRuntimeReactBridge(): void {
  installExtensionRuntimeReactBridge({
    React,
    jsxDevRuntime: ReactJsxDevRuntime,
    jsxRuntime: ReactJsxRuntime
  })
}

async function requestHost(
  sessionId: string,
  request: ExtensionHostRequest
): Promise<ExtensionHostResponse> {
  const transportRequest =
    request.capability === "navigation"
      ? normalizeExtensionRuntimeNavigationHostRequest(request)
      : request
  return new Promise((resolve) => {
    pendingHostResponses.set(transportRequest.id, resolve)
    try {
      postToHost({
        request: transportRequest,
        sessionId,
        type: "host-request"
      })
    } catch (error) {
      if (pendingHostResponses.get(transportRequest.id) === resolve) {
        pendingHostResponses.delete(transportRequest.id)
      }
      throw error
    }
  })
}

function postRuntimeError(sessionId: string, error: unknown): void {
  postToHost({
    error: toRuntimeError("runtime_error", error),
    sessionId,
    type: "error"
  })
}

function toRuntimeError(code: string, error: unknown): ExtensionRuntimeError {
  return {
    code,
    message: error instanceof Error ? error.message : String(error)
  }
}

function getParentPort(): NonNullable<typeof process.parentPort> {
  const port = process.parentPort as typeof process.parentPort | undefined
  if (!port) {
    throw new Error("Extension runtime parent port is unavailable.")
  }

  return port
}

function installRuntimeCacheBackend(): void {
  const cacheDir = process.env[EXTENSION_RUNTIME_CACHE_DIR_ENV]
  if (!cacheDir) {
    return
  }

  installExtensionRuntimeCacheBackend(createFileExtensionRuntimeCacheBackend(cacheDir))
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (!value || typeof value !== "object" || seen.has(value)) {
    return value
  }

  seen.add(value)
  for (const child of Object.values(value)) {
    deepFreeze(child, seen)
  }
  return Object.freeze(value)
}
