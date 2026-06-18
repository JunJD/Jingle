import type { LauncherResultAvailability, LauncherResultKind } from "./launcher"
import type { LocalStartItemKind } from "./local-start"

export type LauncherSearchSource =
  | "applications"
  | "browser-history"
  | "files"
  | "quicklinks"
  | "semantic-history"
  | "threads"

export interface LauncherSearchRequest {
  query: string
  limit: number
  sources?: LauncherSearchSource[]
  threadMetadataSource?: string
}

export type LauncherActionExecutor = "internal" | "shell"

export interface LauncherOpenPathTarget {
  kind: LocalStartItemKind | "application"
  path: string
}

export interface LauncherOpenUrlTarget {
  url: string
}

export type LauncherSearchAction =
  | {
      executor: "shell"
      localStartItemId?: string
      target: LauncherOpenPathTarget
      type: "open-path"
    }
  | {
      executor: "shell"
      target: LauncherOpenUrlTarget
      type: "open-url"
    }
  | {
      executor: "internal"
      target: null
      type: "none"
    }
  | {
      executor: "internal"
      target: {
        threadId: string
      }
      type: "open-history-thread"
    }
  | {
      executor: "internal"
      target: {
        commandName: string
        extensionName: string
        launchProps?: import("./extension-runtime-protocol").ExtensionRuntimeLaunchProps
      }
      type: "open-extension-command"
    }

export interface LauncherActionExecutionResult {
  ok: boolean
  error?: string
}

export interface LauncherSearchResult {
  id: string
  source: LauncherSearchSource
  kind: LauncherResultKind
  historyKey?: string
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
