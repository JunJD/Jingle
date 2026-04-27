import { parentPort } from "electron"
import type {
  ExtensionHostToRuntimeMessage,
  ExtensionRuntimeToHostMessage
} from "@shared/extension-runtime-protocol"

parentPort.on("message", (event) => {
  const message = event.data as ExtensionHostToRuntimeMessage

  switch (message.type) {
    case "start":
      postToHost({
        sessionId: message.sessionId,
        type: "ready"
      })
      return
    case "stop":
      process.exit(0)
      return
    case "event":
    case "host-response":
      return
  }
})

function postToHost(message: ExtensionRuntimeToHostMessage): void {
  parentPort.postMessage(message)
}
