import type { WebContents } from "electron"

export type WindowIdentity =
  | { kind: "main" | "thread-window"; threadId: string | null; windowId: string }
  | { kind: "launcher" }
  | { kind: "settings" }
  | { kind: "ipc-network" }

export interface DurableWindowCallerLease {
  readonly incarnation: number
  readonly signal: AbortSignal
  readonly threadId: string | null
  readonly window: Readonly<{
    kind: "main" | "thread-window"
    windowId: string
  }>
}

interface LiveDurableWindowBinding {
  readonly controller: AbortController
  readonly destroyedListener: () => void
  readonly lease: DurableWindowCallerLease
}

const identities = new WeakMap<WebContents, WindowIdentity>()
const liveDurableWindowBindings = new WeakMap<WebContents, LiveDurableWindowBinding>()
const durableWindowBindingOperations = new WeakMap<WebContents, object>()
let nextDurableWindowIncarnation = 1

export function registerWindowIdentity(webContents: WebContents, identity: WindowIdentity): void {
  const operation = beginDurableWindowBindingOperation(webContents)
  assertCurrentDurableWindowBindingOperation(webContents, operation)
  identities.set(webContents, identity)
}

export function registerDurableWindowIdentity(
  webContents: WebContents,
  identity: Extract<WindowIdentity, { kind: "main" | "thread-window" }>
): DurableWindowCallerLease {
  if (webContents.isDestroyed()) {
    throw new Error("Cannot register a destroyed durable window.")
  }
  const operation = beginDurableWindowBindingOperation(webContents)
  assertCurrentDurableWindowBindingOperation(webContents, operation)
  identities.set(webContents, identity)
  return issueDurableWindowBinding(webContents, identity, operation)
}

export function getWindowIdentity(webContents: WebContents): WindowIdentity | null {
  if (webContents.isDestroyed()) return null
  return identities.get(webContents) ?? null
}

export function setDurableWindowIdentityThread(
  webContents: WebContents,
  threadId: string | null
): void {
  const identity = getWindowIdentity(webContents)
  if (identity?.kind !== "main" && identity?.kind !== "thread-window") {
    throw new Error("Durable window identity is unavailable.")
  }
  if (identity.threadId === threadId) return
  if (!liveDurableWindowBindings.has(webContents)) {
    identity.threadId = threadId
    return
  }
  const operation = beginDurableWindowBindingOperation(webContents)
  assertCurrentDurableWindowBindingOperation(webContents, operation)
  if (identities.get(webContents) !== identity) {
    throw new Error("Durable window identity changed during caller revocation.")
  }
  identity.threadId = threadId
  issueDurableWindowBinding(webContents, identity, operation)
}

export function getDurableWindowCallerLease(
  webContents: WebContents
): DurableWindowCallerLease | null {
  if (webContents.isDestroyed()) {
    revokeDurableWindowBinding(webContents)
    return null
  }
  return liveDurableWindowBindings.get(webContents)?.lease ?? null
}

export function isDurableWindowIdentity(
  identity: WindowIdentity | null
): identity is Extract<WindowIdentity, { kind: "main" | "thread-window" }> {
  return identity?.kind === "main" || identity?.kind === "thread-window"
}

function issueDurableWindowBinding(
  webContents: WebContents,
  identity: Extract<WindowIdentity, { kind: "main" | "thread-window" }>,
  operation: object
): DurableWindowCallerLease {
  assertCurrentDurableWindowBindingOperation(webContents, operation)
  if (!Number.isSafeInteger(nextDurableWindowIncarnation)) {
    throw new Error("Durable window incarnation space is exhausted.")
  }
  const controller = new AbortController()
  const lease = Object.freeze({
    incarnation: nextDurableWindowIncarnation++,
    signal: controller.signal,
    threadId: identity.threadId,
    window: Object.freeze({ kind: identity.kind, windowId: identity.windowId })
  }) satisfies DurableWindowCallerLease
  const destroyedListener = (): void => {
    const current = liveDurableWindowBindings.get(webContents)
    if (current?.lease !== lease) return
    liveDurableWindowBindings.delete(webContents)
    current.controller.abort(new Error("Durable window caller was destroyed."))
  }
  liveDurableWindowBindings.set(webContents, {
    controller,
    destroyedListener,
    lease
  })
  webContents.once("destroyed", destroyedListener)
  return lease
}

function beginDurableWindowBindingOperation(webContents: WebContents): object {
  const operation = {}
  durableWindowBindingOperations.set(webContents, operation)
  revokeDurableWindowBinding(webContents)
  return operation
}

function assertCurrentDurableWindowBindingOperation(
  webContents: WebContents,
  operation: object
): void {
  if (durableWindowBindingOperations.get(webContents) !== operation) {
    throw new Error("Durable window caller changed during revocation.")
  }
}

function revokeDurableWindowBinding(webContents: WebContents): void {
  const current = liveDurableWindowBindings.get(webContents)
  if (!current) return
  webContents.removeListener("destroyed", current.destroyedListener)
  current.controller.abort(new Error("Durable window caller was rebound."))
  if (liveDurableWindowBindings.get(webContents) === current) {
    liveDurableWindowBindings.delete(webContents)
  }
}
