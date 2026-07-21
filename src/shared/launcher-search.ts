import { z } from "zod/v4"
import {
  MAX_LAUNCHER_SEARCH_RESULTS,
  type LauncherResultAvailability,
  type LauncherResultKind
} from "./launcher"
import type { LocalStartItemKind } from "./local-start"

export const MAX_LAUNCHER_SEARCH_QUERY_LENGTH = 512
export const MAX_LAUNCHER_SEARCH_CALLER_ID_LENGTH = 128
export const MAX_LAUNCHER_THREAD_METADATA_SOURCE_LENGTH = 128

export const launcherSearchSourceSchema = z.enum([
  "applications",
  "browser-history",
  "files",
  "quicklinks",
  "semantic-history",
  "threads"
])
export type LauncherSearchSource = z.infer<typeof launcherSearchSourceSchema>

const launcherSearchSourcesSchema = z
  .array(launcherSearchSourceSchema)
  .max(launcherSearchSourceSchema.options.length)
  .refine((sources) => new Set(sources).size === sources.length, {
    message: "Launcher search sources must be unique."
  })

export const launcherSearchRequestSchema = z
  .object({
    limit: z.number().finite().int().min(1).max(MAX_LAUNCHER_SEARCH_RESULTS),
    query: z.string().max(MAX_LAUNCHER_SEARCH_QUERY_LENGTH),
    sources: launcherSearchSourcesSchema.optional(),
    threadMetadataSource: z
      .string()
      .min(1)
      .max(MAX_LAUNCHER_THREAD_METADATA_SOURCE_LENGTH)
      .optional()
  })
  .strict()
export type LauncherSearchRequest = z.infer<typeof launcherSearchRequestSchema>

export const launcherSearchInvocationSchema = z
  .object({
    callerId: z.string().min(1).max(MAX_LAUNCHER_SEARCH_CALLER_ID_LENGTH),
    request: launcherSearchRequestSchema
  })
  .strict()
export type LauncherSearchInvocation = z.infer<typeof launcherSearchInvocationSchema>

export const launcherSearchCancellationSchema = z
  .object({
    callerId: z.string().min(1).max(MAX_LAUNCHER_SEARCH_CALLER_ID_LENGTH)
  })
  .strict()
export type LauncherSearchCancellation = z.infer<typeof launcherSearchCancellationSchema>

export const launcherSearchInvocationArgsSchema = z.tuple([launcherSearchInvocationSchema])
export const launcherSearchCancellationArgsSchema = z.tuple([launcherSearchCancellationSchema])

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

export type LauncherSearchTerminal =
  | {
      kind: "complete"
    }
  | {
      kind: "partial"
      partialSources: LauncherSearchSource[]
      unavailableSources: LauncherSearchSource[]
    }

export interface LauncherSearchResponse {
  query: string
  results: LauncherSearchResult[]
  terminal: LauncherSearchTerminal
}
