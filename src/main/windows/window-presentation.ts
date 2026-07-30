import type { BrowserWindow } from "electron"

interface WindowPresentationState {
  activationEpoch: number | null
  maximizeOnActivation: boolean
  presentationRequest: "activate" | "visible" | null
  rendererReady: boolean
}

interface WindowPresentationOptions {
  maximizeOnActivation?: boolean
}

const windowPresentationStates = new WeakMap<BrowserWindow, WindowPresentationState>()
const activationTrackedWindows = new WeakSet<BrowserWindow>()
let currentWindowActivationEpoch = 0
let windowPresentationShutdownStarted = false

export function beginWindowPresentationShutdown(): void {
  windowPresentationShutdownStarted = true
}

function recordWindowActivation(): void {
  currentWindowActivationEpoch += 1
}

export function installWindowActivationTracking(window: BrowserWindow): void {
  if (window.isDestroyed()) {
    throw new Error("Cannot track activation for a destroyed window.")
  }
  if (activationTrackedWindows.has(window)) {
    return
  }

  activationTrackedWindows.add(window)
  window.on("focus", recordWindowActivation)
}

function applyPendingMaximization(window: BrowserWindow, state: WindowPresentationState): void {
  if (windowPresentationShutdownStarted || !state.maximizeOnActivation || window.isDestroyed()) {
    return
  }

  state.maximizeOnActivation = false
  if (!window.isMaximized()) {
    window.maximize()
  }
}

function presentIfReady(window: BrowserWindow, state: WindowPresentationState): void {
  if (windowPresentationShutdownStarted) {
    state.activationEpoch = null
    state.presentationRequest = null
    return
  }
  const presentationRequest = state.presentationRequest
  if (!presentationRequest || !state.rendererReady || window.isDestroyed()) {
    return
  }

  const shouldActivate =
    presentationRequest === "activate" && state.activationEpoch === currentWindowActivationEpoch
  state.activationEpoch = null
  state.presentationRequest = null
  if (!shouldActivate) {
    if (!window.isVisible()) window.showInactive()
    return
  }
  if (window.isMinimized()) window.restore()
  applyPendingMaximization(window, state)
  if (!window.isVisible()) window.show()
  window.focus()
}

export function installWindowPresentation(
  window: BrowserWindow,
  options: WindowPresentationOptions = {}
): void {
  if (window.isDestroyed()) {
    throw new Error("Cannot install presentation for a destroyed window.")
  }
  if (windowPresentationStates.has(window)) {
    return
  }

  const state: WindowPresentationState = {
    activationEpoch: null,
    maximizeOnActivation: options.maximizeOnActivation === true,
    presentationRequest: null,
    rendererReady: false
  }
  const markRendererReady = (): void => {
    state.rendererReady = true
    presentIfReady(window, state)
  }

  windowPresentationStates.set(window, state)
  installWindowActivationTracking(window)
  window.on("focus", () => applyPendingMaximization(window, state))
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
  if (request === "activate") {
    state.activationEpoch = currentWindowActivationEpoch
    state.presentationRequest = request
  } else if (state.presentationRequest !== "activate") {
    state.activationEpoch = null
    state.presentationRequest = request
  }
  presentIfReady(window, state)
}
