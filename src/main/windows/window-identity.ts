import type { WebContents } from "electron"

export type WindowIdentity =
  | { kind: "main" | "thread-window"; threadId: string | null; windowId: string }
  | { kind: "launcher" }
  | { kind: "settings" }
  | { kind: "ipc-network" }

const identities = new WeakMap<WebContents, WindowIdentity>()

export function registerWindowIdentity(webContents: WebContents, identity: WindowIdentity): void {
  identities.set(webContents, identity)
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
  identity.threadId = threadId
}

export function isDurableWindowIdentity(
  identity: WindowIdentity | null
): identity is Extract<WindowIdentity, { kind: "main" | "thread-window" }> {
  return identity?.kind === "main" || identity?.kind === "thread-window"
}
