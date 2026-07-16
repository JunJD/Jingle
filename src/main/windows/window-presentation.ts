import type { BrowserWindow } from "electron"

interface WindowPresentationState {
  presentationRequested: boolean
  rendererReady: boolean
}

const windowPresentationStates = new WeakMap<BrowserWindow, WindowPresentationState>()

function presentIfReady(window: BrowserWindow, state: WindowPresentationState): void {
  if (!state.presentationRequested || !state.rendererReady || window.isDestroyed()) {
    return
  }

  state.presentationRequested = false
  if (window.isMinimized()) {
    window.restore()
  }
  if (!window.isVisible()) {
    window.show()
  }
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
    presentationRequested: false,
    rendererReady: false
  }
  const markRendererReady = (): void => {
    state.rendererReady = true
    presentIfReady(window, state)
  }

  windowPresentationStates.set(window, state)
  window.once("ready-to-show", markRendererReady)
}

export function requestWindowPresentation(window: BrowserWindow): void {
  if (window.isDestroyed()) {
    throw new Error("Cannot present a destroyed window.")
  }

  const state = windowPresentationStates.get(window)
  if (!state) {
    throw new Error("Window presentation must be installed before it is requested.")
  }

  state.presentationRequested = true
  presentIfReady(window, state)
}
