import { dialog } from "electron"
import type { RendererWindowLoadFailure } from "./load-renderer-window"

function describeTerminalRendererFailure(failure: RendererWindowLoadFailure): string | null {
  if (failure.phase === "renderer-process") {
    if (failure.details.reason === "clean-exit") {
      return null
    }
    if (failure.details.reason === "oom") {
      return "This Jingle window ran out of memory and could not be restored. Restart Jingle to continue."
    }
    if (failure.details.reason === "integrity-failure") {
      return "This Jingle window failed an integrity check and cannot continue. Reinstall or update Jingle before retrying."
    }
  }
  return "This Jingle window stopped unexpectedly and could not be restored. Restart Jingle to continue."
}

export function showTerminalRendererWindowFailure(failure: RendererWindowLoadFailure): void {
  const message = describeTerminalRendererFailure(failure)
  if (!message) {
    return
  }
  dialog.showErrorBox("Jingle window could not be restored", message)
}
