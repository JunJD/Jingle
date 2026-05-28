import { createElement } from "react"
import { getNativeExtensionRuntimeCommand } from "@extensions/runtime"
import type {
  ExtensionHostRequest,
  ExtensionHostResponse,
  ExtensionHostToRuntimeMessage,
  ExtensionRuntimeError,
  ExtensionRuntimeEvent,
  ExtensionRuntimeLaunchContext,
  ExtensionRuntimeToHostMessage
} from "@shared/extension-runtime-protocol"
import { createExtensionRuntimeRenderer, type ExtensionRuntimeRenderer } from "./reconciler/render"
import {
  createExtensionRuntimeLaunchProps,
  createExtensionRuntimeNavigation,
  ExtensionRuntimeNavigationProvider,
  runWithExtensionRuntimeSdk,
  type ExtensionRuntimeHostRequestInput
} from "./sdk"

let activeRenderer: ExtensionRuntimeRenderer | null = null
const pendingHostResponses = new Map<string, (response: ExtensionHostResponse) => void>()
let hostRequestIndex = 0

const parentPort = getParentPort()

parentPort.on("message", (event) => {
  const message = event.data as ExtensionHostToRuntimeMessage

  switch (message.type) {
    case "start":
      void startRuntime(message.sessionId, message.context)
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
  context: ExtensionRuntimeLaunchContext
): Promise<void> {
  try {
    const command = getNativeExtensionRuntimeCommand(context)
    if (!command) {
      throw new Error(
        `Extension runtime command "${context.extensionName}:${context.commandName}" is not registered.`
      )
    }

    if (command.mode !== context.mode) {
      throw new Error(
        `Extension runtime command "${context.extensionName}:${context.commandName}" is registered for "${command.mode}" but launched as "${context.mode}".`
      )
    }

    const requestHostWithId = (request: ExtensionRuntimeHostRequestInput) =>
      requestHost(sessionId, withHostRequestId(request))
    const resolvedContext = await resolveRuntimeLaunchContext(context, requestHostWithId)

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

    activeRenderer = createExtensionRuntimeRenderer(
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
    activeRenderer.render(
      createElement(
        ExtensionRuntimeNavigationProvider,
        {
          value: {
            ...resolvedContext,
            requestHost: requestHostWithId
          }
        },
        createElement(command.Component, createExtensionRuntimeLaunchProps(resolvedContext))
      )
    )
    void activeRenderer
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

async function resolveRuntimeLaunchContext(
  context: ExtensionRuntimeLaunchContext,
  requestHost: (request: ExtensionRuntimeHostRequestInput) => Promise<ExtensionHostResponse>
): Promise<ExtensionRuntimeLaunchContext> {
  const extensionPreferencesResponse = await requestHost({
    capability: "preferences",
    method: "get-extension-preferences",
    payload: {
      extensionName: context.extensionName
    }
  })
  if (!extensionPreferencesResponse.ok) {
    throw new Error(extensionPreferencesResponse.error.message)
  }

  const commandPreferencesResponse = await requestHost({
    capability: "preferences",
    method: "get-command-preferences",
    payload: {
      commandName: context.commandName,
      extensionName: context.extensionName
    }
  })
  if (!commandPreferencesResponse.ok) {
    throw new Error(commandPreferencesResponse.error.message)
  }

  return {
    ...context,
    commandPreferences: commandPreferencesResponse.result as Record<string, unknown>,
    extensionPreferences: extensionPreferencesResponse.result as Record<string, unknown>
  }
}

function withHostRequestId(request: ExtensionRuntimeHostRequestInput): ExtensionHostRequest {
  return {
    ...request,
    id: `runtime-host-request-${hostRequestIndex++}`
  } as ExtensionHostRequest
}

function requestHost(
  sessionId: string,
  request: ExtensionHostRequest
): Promise<ExtensionHostResponse> {
  return new Promise((resolve) => {
    pendingHostResponses.set(request.id, resolve)
    postToHost({
      request,
      sessionId,
      type: "host-request"
    })
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
