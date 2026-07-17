import type { BrowserWindow } from "electron"

interface WindowPresentationState {
  presentationRequest: "activate" | "visible" | null
  rendererReady: boolean
}

const windowPresentationStates = new WeakMap<BrowserWindow, WindowPresentationState>()

function presentIfReady(window: BrowserWindow, state: WindowPresentationState): void {
  const presentationRequest = state.presentationRequest
  if (!presentationRequest || !state.rendererReady || window.isDestroyed()) {
    return
  }

  state.presentationRequest = null
  if (presentationRequest === "visible") {
    if (!window.isVisible()) window.showInactive()
    return
  }
  if (window.isMinimized()) window.restore()
  if (!window.isVisible()) window.show()
  window.focus()
}

export function installWindowPresentation(window: BrowserWindow): void {
  if (window.isDestroyed()) {
    throw new Error("Cannot install presentation for a destroyed window.")
  }
  if (windowPresentationStates.has(window)) {
    return
  }

  const state: WindowPresentationState = {
    presentationRequest: null,
    rendererReady: false
  }
  const markRendererReady = (): void => {
    state.rendererReady = true
    presentIfReady(window, state)
  }

  windowPresentationStates.set(window, state)
  window.once("ready-to-show", markRendererReady)
}

export function requestWindowPresentation(
  window: BrowserWindow,
  options: { activate?: boolean } = {}
): void {
  if (window.isDestroyed()) {
    throw new Error("Cannot present a destroyed window.")
  }

  const state = windowPresentationStates.get(window)
  if (!state) {
    throw new Error("Window presentation must be installed before it is requested.")
  }

  const request = options.activate === false ? "visible" : "activate"
  if (state.presentationRequest !== "activate") state.presentationRequest = request
  presentIfReady(window, state)
}
