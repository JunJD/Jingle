import * as React from "react"
import * as ReactJsxDevRuntime from "react/jsx-dev-runtime"
import * as ReactJsxRuntime from "react/jsx-runtime"
import { ExtensionRuntimeRequestError } from "@jingle/extension-api"
import type {
  ExtensionHostRequest,
  ExtensionHostResponse,
  ExtensionHostToRuntimeMessage,
  ExtensionRuntimeError,
  ExtensionRuntimeEvent,
  ExtensionRuntimeCacheWriterLease,
  ExtensionRuntimeUtilityExecutionLease,
  ExtensionRuntimeToHostMessage
} from "@shared/extension-runtime-protocol"
import { assertExtensionRuntimeCacheWriterLeaseOwnsExecution } from "@shared/extension-runtime-protocol"
import {
  ExtensionRuntimeArtifactLoadError,
  loadNativeExtensionRuntimeCommand
} from "./runtime-package-loader"
import {
  createFileExtensionRuntimeCacheBackend,
  EXTENSION_RUNTIME_CACHE_DIR_ENV,
  EXTENSION_RUNTIME_CACHE_WRITER_LEASE_ENV,
  resolveExtensionRuntimeCacheWriterEnvironment
} from "./cache-backend"
import { createExtensionRuntimeCacheLifecycle } from "./cache-lifecycle"
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
  type ExtensionRuntimeHostRequestInput,
  type RuntimeCacheBackend
} from "@jingle/extension-api/host-runtime"

let activeRenderer: ExtensionRuntimeRenderer | null = null
const pendingHostResponses = new Map<string, (response: ExtensionHostResponse) => void>()
let hostRequestIndex = 0

const parentPort = getParentPort()
installRuntimeReactBridge()
const runtimeCacheInstallation = installRuntimeCacheBackend()
const runtimeCacheLifecycle = createExtensionRuntimeCacheLifecycle(
  runtimeCacheInstallation.backend,
  {
    onPersistenceFailure: (sessionId) => {
      postToHost({ sessionId, type: "cache-persistence-failed" })
    },
    writerSessionId: runtimeCacheInstallation.writerSessionId
  }
)

parentPort.on("message", (event) => {
  const message = event.data as ExtensionHostToRuntimeMessage

  switch (message.type) {
    case "start":
      void startRuntime(message.sessionId, message.lease)
      return
    case "stop":
      void stopRuntime(message.sessionId)
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
    assertExtensionRuntimeCacheWriterLeaseOwnsExecution(runtimeCacheInstallation.writerLease, lease)
    runtimeCacheLifecycle.bindSession(sessionId)
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
    const reportFatalError = (error: unknown): void => {
      postRuntimeError(sessionId, error)
    }

    if (command.mode === "no-view") {
      const navigation = createExtensionRuntimeNavigation({
        requestHost: requestHostWithId
      })
      void runWithExtensionRuntimeSdk(
        {
          ...resolvedContext,
          navigation,
          reportFatalError,
          requestHost: requestHostWithId
        },
        () =>
          command.run({
            ...resolvedContext,
            navigation
          })
      )
        .then(async () => {
          if (!(await runtimeCacheLifecycle.flushBeforeReady(sessionId))) {
            return
          }
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
        onError: reportFatalError,
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
            reportFatalError,
            requestHost: requestHostWithId,
            registerToastAction: renderer.registerToastAction
          }
        },
        React.createElement(command.Component, createExtensionRuntimeLaunchProps(resolvedContext))
      )
    )
    void renderer
      .flushSnapshots()
      .then(async () => {
        if (!(await runtimeCacheLifecycle.flushBeforeReady(sessionId))) {
          return
        }
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

async function stopRuntime(sessionId: string): Promise<void> {
  const result = await runtimeCacheLifecycle.stop(sessionId)
  postToHost({ result, sessionId, type: "stopped" })
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
  if (error instanceof ExtensionRuntimeArtifactLoadError) {
    return {
      code: error.code,
      message: error.message
    }
  }
  if (error instanceof ExtensionRuntimeRequestError) {
    return {
      code: error.code,
      ...(error.details ? { details: error.details } : {}),
      message: error.message
    }
  }
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

function installRuntimeCacheBackend(): {
  backend: RuntimeCacheBackend
  writerLease: ExtensionRuntimeCacheWriterLease
  writerSessionId: string
} {
  const { cacheDir, writerLease } = resolveExtensionRuntimeCacheWriterEnvironment(
    process.env[EXTENSION_RUNTIME_CACHE_DIR_ENV],
    process.env[EXTENSION_RUNTIME_CACHE_WRITER_LEASE_ENV]
  )
  const backend = createFileExtensionRuntimeCacheBackend(cacheDir, { writerLease })
  installExtensionRuntimeCacheBackend(backend)
  return { backend, writerLease, writerSessionId: writerLease.sessionId }
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
