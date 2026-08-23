import { PRIMARY_MAIN_WINDOW_ID } from "@shared/durable-window"

interface ReleaseSmokeWebContents {
  getType(): string
  getURL(): string
  isDestroyed(): boolean
  isLoading(): boolean
}

interface ReleaseSmokeWindowIdentity {
  kind: string
  windowId?: string
}

export function selectReleaseSmokeMainWebContents<T extends ReleaseSmokeWebContents>(
  candidates: readonly T[],
  getIdentity: (contents: T) => ReleaseSmokeWindowIdentity | null
): T | null {
  const mainCandidates = candidates.filter((contents) => {
    if (contents.getType() !== "window" || contents.isDestroyed() || contents.isLoading()) {
      return false
    }
    const identity = getIdentity(contents)
    if (identity?.kind !== "main" || identity.windowId !== PRIMARY_MAIN_WINDOW_ID) {
      return false
    }
    try {
      const url = new URL(contents.getURL())
      return url.protocol === "file:" && url.searchParams.get("window") === "main"
    } catch {
      return false
    }
  })
  if (mainCandidates.length > 1) {
    throw new Error("release smoke found multiple primary main renderer windows")
  }
  return mainCandidates[0] ?? null
}
