export const PRIMARY_MAIN_WINDOW_KIND = "main"
export const THREAD_WINDOW_KIND = "thread-window"

export type DurableWindowKind = typeof PRIMARY_MAIN_WINDOW_KIND | typeof THREAD_WINDOW_KIND

export interface OpenPrimaryMainWindowParams {
  threadId?: string
}

export interface PinThreadWindowParams {
  threadId?: string
}

export type PinThreadWindowResult =
  | { ok: true; windowId: string }
  | { current: number; limit: number; ok: false; reason: "resource_limit" }

export interface SetDurableWindowThreadParams {
  threadId: string
}

export interface DurableWindowThreadChangedEvent {
  threadId: string
}
