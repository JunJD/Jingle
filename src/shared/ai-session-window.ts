export const PINNED_AI_SESSION_WINDOW_KIND = "pinned-ai-session"
export const PINNED_AI_SESSION_WINDOW_LIMIT = 3

export interface OpenPinnedAiSessionWindowParams {
  threadId: string
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
