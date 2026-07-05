export const PINNED_AI_SESSION_WINDOW_KIND = "pinned-ai-session"
export const PINNED_AI_SESSION_WINDOW_LIMIT = 3

export interface OpenPinnedAiSessionWindowParams {
  threadId: string
}

export interface UpdatePinnedAiSessionWindowThreadParams {
  threadId: string
  windowId: string
}

export type OpenPinnedAiSessionWindowResult =
  | {
      ok: true
      windowId: string
    }
  | {
      limit: number
      ok: false
      reason: "limit_reached"
    }

export type UpdatePinnedAiSessionWindowThreadResult =
  | {
      ok: true
    }
  | {
      ok: false
      reason: "thread_already_open"
      windowId: string
    }
