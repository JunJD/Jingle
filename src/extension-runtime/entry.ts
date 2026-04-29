import { createElement } from "react"
import { getNativeExtensionRuntimeCommand } from "@extensions/runtime"
import type {
  ExtensionHostRequest,
  ExtensionHostResponse,
  ExtensionHostToRuntimeMessage,
  ExtensionRuntimeLaunchContext,
  ExtensionRuntimeToHostMessage
} from "@shared/extension-runtime-protocol"
import { createExtensionRuntimeRenderer, type ExtensionRuntimeRenderer } from "./reconciler/render"
import {
  ExtensionRuntimeNavigationProvider,
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
      startRuntime(message.sessionId, message.context)
      return
    case "stop":
      process.exit(0)
      return
    case "event":
      void activeRenderer?.dispatchEvent(message.event).catch((error) => {
        postRuntimeError(message.sessionId, error)
      })
      return
    case "host-response":
      pendingHostResponses.get(message.response.id)?.(message.response)
      pendingHostResponses.delete(message.response.id)
      return
  }
})

function postToHost(message: ExtensionRuntimeToHostMessage): void {
  parentPort.postMessage(message)
}

function startRuntime(sessionId: string, context: ExtensionRuntimeLaunchContext): void {
  try {
    const command = getNativeExtensionRuntimeCommand(context)
    if (!command) {
      throw new Error(
        `Extension runtime command "${context.extensionName}:${context.commandName}" is not registered.`
      )
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
            ...context,
            requestHost: (request) => requestHost(sessionId, withHostRequestId(request))
          },
          children: createElement(command.Component)
        }
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
    error: {
      code: "runtime_error",
      message: error instanceof Error ? error.message : String(error)
    },
    sessionId,
    type: "error"
  })
}

function getParentPort(): NonNullable<typeof process.parentPort> {
  const port = process.parentPort as typeof process.parentPort | undefined
  if (!port) {
    throw new Error("Extension runtime parent port is unavailable.")
  }

  return port
}
