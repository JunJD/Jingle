import { join } from "path"
import { utilityProcess, type UtilityProcess } from "electron"
import type {
  ExtensionHostToRuntimeMessage,
  ExtensionRuntimeToHostMessage
} from "@shared/extension-runtime-protocol"
import { EXTENSION_RUNTIME_CACHE_DIR_ENV } from "../../../extension-runtime/cache-backend"
import { getJingleHomeDir } from "../../storage"
import type { ExtensionRuntimeProcess, ExtensionRuntimeProcessLauncher } from "./runtime-process"

export function resolveExtensionRuntimeEntryPath(): string {
  return join(__dirname, "extension-runtime-entry.js")
}

export class UtilityProcessExtensionRuntimeProcessLauncher implements ExtensionRuntimeProcessLauncher {
  constructor(private readonly modulePath = resolveExtensionRuntimeEntryPath()) {}

  launch(): ExtensionRuntimeProcess {
    const child = utilityProcess.fork(this.modulePath, [], {
      env: {
        ...process.env,
        [EXTENSION_RUNTIME_CACHE_DIR_ENV]: join(getJingleHomeDir(), "extension-runtime-cache")
      },
      serviceName: "Jingle Extension Runtime"
    })

    return new UtilityProcessExtensionRuntimeProcess(child)
  }
}

class UtilityProcessExtensionRuntimeProcess implements ExtensionRuntimeProcess {
  constructor(private readonly child: UtilityProcess) {}

  get pid(): number | undefined {
    return this.child.pid
  }

  kill(): void {
    this.child.kill()
  }

  onExit(listener: (code: number) => void): () => void {
    this.child.on("exit", listener)
    return () => {
      this.child.off("exit", listener)
    }
  }

  onMessage(listener: (message: ExtensionRuntimeToHostMessage) => void): () => void {
    const handleMessage = (message: unknown): void => {
      listener(message as ExtensionRuntimeToHostMessage)
    }

    this.child.on("message", handleMessage)
    return () => {
      this.child.off("message", handleMessage)
    }
  }

  postMessage(message: ExtensionHostToRuntimeMessage): void {
    this.child.postMessage(message)
  }
}
