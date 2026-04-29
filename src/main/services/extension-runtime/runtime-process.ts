import type {
  ExtensionHostToRuntimeMessage,
  ExtensionRuntimeToHostMessage
} from "@shared/extension-runtime-protocol"

export interface ExtensionRuntimeProcess {
  readonly pid?: number
  kill: () => void
  onExit: (listener: (code: number) => void) => () => void
  onMessage: (listener: (message: ExtensionRuntimeToHostMessage) => void) => () => void
  postMessage: (message: ExtensionHostToRuntimeMessage) => void
}

export interface ExtensionRuntimeProcessLauncher {
  launch: () => ExtensionRuntimeProcess
}
