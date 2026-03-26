import type { LauncherResultAvailability, LauncherResultKind } from "./launcher"
import type { LocalStartItemKind } from "./local-start"

export type LauncherSearchSource = "applications" | "browser-history" | "files" | "semantic-history"

export interface LauncherSearchRequest {
  query: string
  limit: number
  sources?: LauncherSearchSource[]
}

export type LauncherSearchAction =
  | {
      type: "launch-application"
      applicationPath: string
    }
  | {
      type: "open-local-start-item"
      itemId: string
      itemKind: LocalStartItemKind
      path: string
    }
  | {
      type: "none"
    }

export interface LauncherActionExecutionResult {
  ok: boolean
  error?: string
}

export interface LauncherSearchResult {
  id: string
  source: LauncherSearchSource
  kind: LauncherResultKind
  title: string
  subtitle: string
  score: number
  match?: [number, number]
  iconDataUrl?: string
  availability?: LauncherResultAvailability
  action: LauncherSearchAction
}

export interface LauncherSearchResponse {
  query: string
  results: LauncherSearchResult[]
}
